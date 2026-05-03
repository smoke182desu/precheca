package com.rotautil.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.provider.Settings;
import android.text.TextUtils;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * NotificationPlugin — Capacitor Plugin
 *
 * Ponte entre o RideNotificationListener (Java nativo) e o app React.
 *
 * Métodos expostos ao JavaScript:
 *  - hasPermission()  → verifica se o acesso a notificações está ativo
 *  - requestPermission() → abre a tela de configurações do Android
 *  - startListening() → registra o BroadcastReceiver interno
 *  - stopListening()  → desregistra o receiver
 *
 * Evento emitido via notifyListeners("rideDetected", data):
 *  {
 *    totalPrice:     number,   // R$ valor da corrida
 *    pickupDistance: number,   // km até o passageiro
 *    rideDistance:   number,   // km da corrida
 *    destination:    string,   // bairro/local destino
 *    platform:       string,   // "Uber" | "99" | "InDrive"
 *    rawTitle:       string,   // título original da notificação
 *    rawText:        string    // texto original da notificação
 *  }
 */
@CapacitorPlugin(name = "RideNotification")
public class NotificationPlugin extends Plugin {

    private BroadcastReceiver rideReceiver = null;
    private boolean isListening = false;

    // ── Verifica permissão de acesso a notificações ───────────────────────────

    @PluginMethod
    public void hasPermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", isNotificationListenerEnabled());
        call.resolve(result);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        // Abre a tela de configurações de acesso a notificações do Android
        Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    // ── Inicia escuta ─────────────────────────────────────────────────────────

    @PluginMethod
    public void startListening(PluginCall call) {
        if (isListening) {
            call.resolve();
            return;
        }

        rideReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                if (!RideNotificationListener.ACTION_RIDE_DETECTED.equals(intent.getAction())) return;

                JSObject data = new JSObject();
                data.put("totalPrice",     intent.getFloatExtra("totalPrice",     0f));
                data.put("pickupDistance", intent.getFloatExtra("pickupDistance", 0f));
                data.put("rideDistance",   intent.getFloatExtra("rideDistance",   0f));
                data.put("destination",    intent.getStringExtra("destination"));
                data.put("platform",       intent.getStringExtra("platform"));
                data.put("rawTitle",       intent.getStringExtra("rawTitle"));
                data.put("rawText",        intent.getStringExtra("rawText"));

                // Dispara evento pro React
                notifyListeners("rideDetected", data);
            }
        };

        IntentFilter filter = new IntentFilter(RideNotificationListener.ACTION_RIDE_DETECTED);
        getContext().registerReceiver(rideReceiver, filter);
        isListening = true;

        call.resolve();
    }

    // ── Para escuta ───────────────────────────────────────────────────────────

    @PluginMethod
    public void stopListening(PluginCall call) {
        if (rideReceiver != null) {
            try {
                getContext().unregisterReceiver(rideReceiver);
            } catch (Exception ignored) {}
            rideReceiver = null;
        }
        isListening = false;
        call.resolve();
    }

    // ── Helper ────────────────────────────────────────────────────────────────

    private boolean isNotificationListenerEnabled() {
        String flat = Settings.Secure.getString(
            getContext().getContentResolver(),
            "enabled_notification_listeners"
        );
        if (flat == null || flat.isEmpty()) return false;
        String myPkg = getContext().getPackageName();
        for (String pkg : flat.split(":")) {
            if (pkg.contains(myPkg)) return true;
        }
        return false;
    }

    // ── Cleanup ───────────────────────────────────────────────────────────────

    @Override
    protected void handleOnDestroy() {
        if (rideReceiver != null) {
            try { getContext().unregisterReceiver(rideReceiver); } catch (Exception ignored) {}
            rideReceiver = null;
        }
        super.handleOnDestroy();
    }
}
