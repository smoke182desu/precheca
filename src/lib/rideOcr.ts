/**
 * rideOcr.ts — Leitura automática de corrida por imagem
 *
 * Usa Gemini Vision para extrair os dados de uma corrida Uber/99
 * a partir de um screenshot enviado pelo motorista.
 *
 * Fluxo:
 *  1. Motorista tira print da tela do Uber/99
 *  2. Compartilha pro PRÉCHECA (ou seleciona da galeria)
 *  3. Gemini lê: preço, km busca, km corrida, destino, rating
 *  4. analyzeRide roda automaticamente
 *  5. Som de ACEITAR (beep verde) ou RECUSAR (beep vermelho) toca
 */

import { GoogleGenAI } from '@google/genai';

// ─── Extracted ride data ──────────────────────────────────────────────────────

export interface ExtractedRideData {
  totalPrice:      number;        // R$ valor da corrida
  pickupDistance:  number;        // km até o passageiro
  rideDistance:    number;        // km da corrida
  destination:     string;        // bairro/endereço de destino
  passengerRating: number;        // avaliação do passageiro (default 4.9)
  platform:        'Uber' | '99'; // plataforma detectada
  rawText:         string;        // texto bruto extraído (para debug)
  confidence:      'high' | 'medium' | 'low';
}

export type OcrResult =
  | { ok: true;  data: ExtractedRideData }
  | { ok: false; error: string };

// ─── Gemini Vision OCR ────────────────────────────────────────────────────────

/**
 * Converte File ou Blob para base64 para enviar ao Gemini
 */
async function fileToBase64(file: File | Blob): Promise<{ data: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve({ data: base64, mimeType: file.type || 'image/jpeg' });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Extrai dados de corrida de uma imagem usando Gemini Vision.
 * A imagem deve ser uma captura de tela do app Uber ou 99.
 */
export async function extractRideFromImage(
  imageFile: File | Blob,
  apiKey?: string
): Promise<OcrResult> {
  // Tenta obter chave em ordem de prioridade
  const key = apiKey
    || (typeof process !== 'undefined' ? process.env.GEMINI_API_KEY : undefined)
    || (import.meta as any).env?.VITE_GEMINI_API_KEY
    || '';

  if (!key) {
    return {
      ok: false,
      error: 'Chave Gemini não configurada. Configure VITE_GEMINI_API_KEY no Vercel para ativar leitura automática.',
    };
  }

  try {
    const { data: base64Data, mimeType } = await fileToBase64(imageFile);

    const ai = new GoogleGenAI({ apiKey: key });

    const prompt = `
Você é um sistema de extração de dados de corridas Uber e 99.

Analise esta captura de tela de um app de motorista (Uber Driver ou 99 Driver) e extraia os dados da corrida que aparece na tela.

Retorne APENAS um JSON válido, sem markdown, sem explicações, exatamente neste formato:
{
  "totalPrice": 0.0,
  "pickupDistance": 0.0,
  "rideDistance": 0.0,
  "destination": "nome do bairro ou endereço de destino",
  "passengerRating": 4.9,
  "platform": "Uber",
  "confidence": "high"
}

Regras:
- totalPrice: valor em reais da corrida (número decimal, ex: 12.50)
- pickupDistance: distância em km até buscar o passageiro (número decimal, ex: 1.5)
- rideDistance: distância total da corrida em km (número decimal, ex: 8.0)
- destination: nome do bairro/local de destino como texto
- passengerRating: avaliação do passageiro (entre 1.0 e 5.0, default 4.9 se não aparecer)
- platform: "Uber" ou "99" baseado no visual do app
- confidence: "high" se leu claramente, "medium" se teve incerteza, "low" se não conseguiu ler bem

Se não conseguir identificar algum campo, use 0 para números e string vazia para textos.
`.trim();

    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { data: base64Data, mimeType } },
          ],
        },
      ],
    });

    const rawText = (response.text ?? '').trim();

    // Remove markdown code blocks se existirem
    const cleanJson = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsed = JSON.parse(cleanJson);

    // Validação mínima
    if (typeof parsed.totalPrice !== 'number') {
      return { ok: false, error: 'Não consegui ler o valor da corrida na imagem.' };
    }

    return {
      ok: true,
      data: {
        totalPrice:      Math.max(0, parsed.totalPrice      || 0),
        pickupDistance:  Math.max(0, parsed.pickupDistance  || 0),
        rideDistance:    Math.max(0, parsed.rideDistance    || 0),
        destination:     parsed.destination                 || '',
        passengerRating: parsed.passengerRating             || 4.9,
        platform:        parsed.platform === '99' ? '99' : 'Uber',
        rawText,
        confidence:      parsed.confidence                  || 'medium',
      },
    };
  } catch (err: any) {
    console.error('[OCR] Gemini error:', err);
    return {
      ok: false,
      error: err?.message?.includes('JSON')
        ? 'Não consegui identificar uma corrida nesta imagem.'
        : `Erro ao processar imagem: ${err?.message || 'tente novamente'}`,
    };
  }
}

// ─── Notification text parser ─────────────────────────────────────────────────
// Fallback: parse notificação de texto puro (para versão Capacitor Android)

export interface NotificationPayload {
  title: string;
  text: string;
  packageName?: string;
}

/**
 * Tenta extrair dados de corrida do texto de uma notificação do Uber/99.
 * Funciona com os formatos de notificação conhecidos.
 *
 * Exemplo Uber: "R$ 12,50 · 1,2 km · Destino: Itaim Bibi"
 * Exemplo 99:   "Corrida R$11,00 | 0.8km até você | 7km de corrida"
 */
export function parseNotificationText(notification: NotificationPayload): Partial<ExtractedRideData> {
  const text = `${notification.title} ${notification.text}`.toLowerCase();
  const result: Partial<ExtractedRideData> = {};

  // Detectar plataforma pelo nome do pacote
  if (notification.packageName?.includes('99')) result.platform = '99';
  else if (notification.packageName?.includes('uber')) result.platform = 'Uber';
  else result.platform = 'Uber'; // default

  // Extrair preço: R$ XX,XX ou R$XX.XX
  const priceMatch = text.match(/r\$\s*([\d]+[.,][\d]+)/i);
  if (priceMatch) {
    result.totalPrice = parseFloat(priceMatch[1].replace(',', '.'));
  }

  // Extrair distância de busca: "1,2 km até você" ou "0.8km até"
  const pickupMatch = text.match(/([\d]+[.,]?[\d]*)\s*km\s*(até|busca|pickup)/i);
  if (pickupMatch) {
    result.pickupDistance = parseFloat(pickupMatch[1].replace(',', '.'));
  }

  // Extrair distância da corrida: "7km de corrida" ou "8 km percurso"
  const rideMatch = text.match(/([\d]+[.,]?[\d]*)\s*km\s*(de corrida|percurso|viagem|total)/i);
  if (rideMatch) {
    result.rideDistance = parseFloat(rideMatch[1].replace(',', '.'));
  }

  // Extrair destino: "destino: Nome" ou "para: Nome"
  const destMatch = text.match(/(?:destino|para):\s*([^|·\n]+)/i);
  if (destMatch) {
    result.destination = destMatch[1].trim();
  }

  result.rawText = `${notification.title} | ${notification.text}`;
  result.confidence = Object.keys(result).length >= 4 ? 'high' : 'low';

  return result;
}
