package com.rotautil.app;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registra o plugin de leitura de notificações do Uber/99
        registerPlugin(NotificationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
