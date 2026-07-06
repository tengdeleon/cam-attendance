// Auth stack vs main app, based on session.
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../hooks/useAuth';
import LoginScreen from '../screens/auth/LoginScreen';
import RosterListScreen from '../screens/roster/RosterListScreen';
import PersonFormScreen from '../screens/roster/PersonFormScreen';
import type { Person } from '../types';

export type RootStackParamList = {
  Login: undefined;
  Roster: undefined;
  PersonForm: { person?: Person } | undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {session ? (
          <>
            <Stack.Screen name="Roster" component={RosterListScreen} />
            <Stack.Screen
              name="PersonForm"
              component={PersonFormScreen}
              options={({ route }) => ({
                headerShown: true,
                title: route.params?.person ? 'Edit person' : 'Add person',
                headerBackTitle: 'Roster',
              })}
            />
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
