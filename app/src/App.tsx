// App entry. Mounts AuthContext + RootNavigator.
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from './context/AuthContext';
import RootNavigator from './navigation/RootNavigator';
import SyncManager from './components/SyncManager';

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <SyncManager />
        <RootNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
