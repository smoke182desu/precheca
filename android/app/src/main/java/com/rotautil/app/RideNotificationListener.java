package com.rotautil.app;

import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.app.Notification;
import android.os.Bundle;
import android.content.Intent;

/**
 * RideNotificationListener
 *
 * Serviço nativo que roda em background e intercepta notificações
 * do Uber Driver e do 99 Driver em tempo real.
 *
 * Quando uma corrida aparece (baseado no texto da notificação),
 * extrai: preço, km busca, km corrida, destino e manda pro app
 * via broadcast para o NotificationPlugin processar.
 *
 * PERMISSÃO NECESSÁRIA: android.permission.BIND_NOTIFICATION_LISTENER_SERVICE
 * O usuário precisa ir em Configurações → Notificações → Acesso especial
 * → Acesso às notificações e ativar o PRÉCHECA.
 */
public class RideNotificationListener extends NotificationListenerService {

    // Pacotes dos apps de corrida monitorados
    private static final String[] RIDE_APPS = {
        "com.ubercab.driver",          // Uber Driver
        "com.ubercab.eats.driver",     // Uber Eats (opcional)
        "com.taxis99.motorista",       // 99 Driver
        "br.com.ninety9.driver",       // 99 Driver (variante)
        "com.indriver.driver",         // InDriver
    };

    // Action do broadcast para o plugin
    public static final String ACTION_RIDE_DETECTED = "com.rotautil.app.RIDE_DETECTED";

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null) return;

        String pkg = sbn.getPackageName();
        if (!isRideApp(pkg)) return;

        Notification notification = sbn.getNotification();
        if (notification == null) return;

        Bundle extras = notification.extras;
        if (extras == null) return;

        // Extrai texto da notificação
        CharSequence titleCs = extras.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence textCs  = extras.getCharSequence(Notification.EXTRA_TEXT);

        String title = titleCs != null ? titleCs.toString() : "";
        String text  = textCs  != null ? textCs.toString()  : "";
        String full  = title + " " + text;

        // Filtra só notificações de corrida (não alertas de conta, promoções, etc.)
        if (!isRideRequest(full)) return;

        // Extrai dados da corrida do texto da notificação
        RideData ride = parseRideText(title, text, pkg);

        // Dispara broadcast para o NotificationPlugin processar
        Intent intent = new Intent(ACTION_RIDE_DETECTED);
        intent.putExtra("totalPrice",     ride.totalPrice);
        intent.putExtra("pickupDistance", ride.pickupDistance);
        intent.putExtra("rideDistance",   ride.rideDistance);
        intent.putExtra("destination",    ride.destination);
        intent.putExtra("platform",       ride.platform);
        intent.putExtra("rawTitle",       title);
        intent.putExtra("rawText",        text);
        sendBroadcast(intent);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private boolean isRideApp(String pkg) {
        for (String app : RIDE_APPS) {
            if (pkg.equals(app)) return true;
        }
        return false;
    }

    /**
     * Determina se a notificação é uma solicitação de corrida.
     * Palavras-chave dos apps: "solicitação", "R$", "nova viagem", "corrida"
     */
    private boolean isRideRequest(String text) {
        String lower = text.toLowerCase();
        return lower.contains("solicita")        // "nova solicitação"
            || lower.contains("nova viagem")
            || lower.contains("novo pedido")
            || lower.contains("viagem disponível")
            || (lower.contains("r$") && (lower.contains("km") || lower.contains("min")))
            || lower.contains("aceitar")
            || lower.contains("corrida disponível");
    }

    /**
     * Extrai dados numéricos da notificação.
     *
     * Formatos conhecidos:
     *  Uber:  "Nova solicitação · R$ 12,50 · 1,2 km · Centro"
     *  99:    "Corrida R$11,00 | 0.8km até você | 7km | Itaim Bibi"
     *  InDrive: "Nova oferta · R$ 18,00 · 2km · 12km · Aeroporto"
     */
    private RideData parseRideText(String title, String text, String pkg) {
        RideData data = new RideData();
        data.platform = platformName(pkg);

        String full = (title + " " + text).toLowerCase();

        // ── Preço: R$ XX,XX ou R$XX.XX ───────────────────────────────────
        java.util.regex.Pattern pricePattern = java.util.regex.Pattern.compile(
            "r\\$\\s*([\\d]+[.,][\\d]+)"
        );
        java.util.regex.Matcher priceMatcher = pricePattern.matcher(full);
        if (priceMatcher.find()) {
            try {
                data.totalPrice = Float.parseFloat(
                    priceMatcher.group(1).replace(",", ".")
                );
            } catch (Exception ignored) {}
        }

        // ── Distância de busca: "X km até você" ou "Xkm busca" ───────────
        java.util.regex.Pattern pickupPattern = java.util.regex.Pattern.compile(
            "([\\d]+[.,]?[\\d]*)\\s*km\\s*(até|busca|pickup|de busca|pegar)"
        );
        java.util.regex.Matcher pickupMatcher = pickupPattern.matcher(full);
        if (pickupMatcher.find()) {
            try {
                data.pickupDistance = Float.parseFloat(
                    pickupMatcher.group(1).replace(",", ".")
                );
            } catch (Exception ignored) {}
        }

        // ── Distância da corrida ──────────────────────────────────────────
        // Tenta "X km de corrida" ou "Xkm percurso"
        java.util.regex.Pattern ridePattern = java.util.regex.Pattern.compile(
            "([\\d]+[.,]?[\\d]*)\\s*km\\s*(de corrida|percurso|viagem|total|de viagem)"
        );
        java.util.regex.Matcher rideMatcher = ridePattern.matcher(full);
        if (rideMatcher.find()) {
            try {
                data.rideDistance = Float.parseFloat(
                    rideMatcher.group(1).replace(",", ".")
                );
            } catch (Exception ignored) {}
        }

        // Fallback: pegar todos os números seguidos de "km" em ordem
        // Primeiro = busca, segundo = corrida (padrão Uber/99)
        if (data.pickupDistance == 0 || data.rideDistance == 0) {
            java.util.regex.Pattern allKmPattern = java.util.regex.Pattern.compile(
                "([\\d]+[.,]?[\\d]*)\\s*km"
            );
            java.util.regex.Matcher allKmMatcher = allKmPattern.matcher(full);
            java.util.List<Float> distances = new java.util.ArrayList<>();
            while (allKmMatcher.find()) {
                try {
                    float d = Float.parseFloat(allKmMatcher.group(1).replace(",", "."));
                    distances.add(d);
                } catch (Exception ignored) {}
            }
            if (distances.size() >= 2 && data.pickupDistance == 0) {
                data.pickupDistance = distances.get(0);
                data.rideDistance   = distances.get(1);
            } else if (distances.size() == 1 && data.rideDistance == 0) {
                data.rideDistance = distances.get(0);
            }
        }

        // ── Destino: última parte após "·" ou "|" ────────────────────────
        String[] separators = { "·", "|", "-", "→", "para:" };
        String[] parts = text.split("[·|\\-→]");
        if (parts.length >= 2) {
            data.destination = parts[parts.length - 1].trim();
        }

        return data;
    }

    private String platformName(String pkg) {
        if (pkg.contains("99")) return "99";
        if (pkg.contains("indriver")) return "InDrive";
        return "Uber";
    }

    // ── Inner class ───────────────────────────────────────────────────────────

    public static class RideData {
        public float  totalPrice     = 0f;
        public float  pickupDistance = 0f;
        public float  rideDistance   = 0f;
        public String destination    = "";
        public String platform       = "Uber";
    }
}
