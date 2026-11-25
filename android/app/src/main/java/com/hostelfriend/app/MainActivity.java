package com.hostelfriend.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginLoadException;
import com.getcapacitor.PluginManager;
import io.capawesome.capacitorjs.plugins.firebase.authentication.FirebaseAuthenticationPlugin;
import java.util.List;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        if (!willAutoLoadFirebaseAuthPlugin()) {
            Logger.warn("FirebaseAuthenticationPlugin was not auto-loaded from capacitor.plugins.json; registering explicitly.");
            registerPlugin(FirebaseAuthenticationPlugin.class);
        }
        super.onCreate(savedInstanceState);
    }

    private boolean willAutoLoadFirebaseAuthPlugin() {
        try {
            PluginManager loader = new PluginManager(getAssets());
            List<Class<? extends Plugin>> pluginClasses = loader.loadPluginClasses();
            return pluginClasses.contains(FirebaseAuthenticationPlugin.class);
        } catch (PluginLoadException ex) {
            Logger.warn("Capacitor auto-plugin discovery failed: " + ex.getMessage());
            return false;
        }
    }
}
