// Auth stack vs main app (tabs + modal-ish screens), based on session.
import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from '../hooks/useAuth';
import LoginScreen from '../screens/auth/LoginScreen';
import CheckInScreen from '../screens/attendance/CheckInScreen';
import CameraScreen from '../screens/attendance/CameraScreen';
import TodayScreen from '../screens/attendance/TodayScreen';
import HistoryScreen from '../screens/reports/HistoryScreen';
import ExportScreen from '../screens/reports/ExportScreen';
import RosterListScreen from '../screens/roster/RosterListScreen';
import PersonFormScreen from '../screens/roster/PersonFormScreen';
import { colors } from '../constants/theme';
import type { Direction, Person } from '../types';

export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
  PersonForm: { person?: Person } | undefined;
  Camera: { person: Person; direction: Direction };
  Export: { start: string; end: string }; // Manila-local yyyy-mm-dd, inclusive
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator();

function MainTabs() {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.gray,
      }}
    >
      <Tabs.Screen
        name="CheckIn"
        component={CheckInScreen}
        options={{
          title: 'Check-In',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>✓</Text>,
        }}
      />
      <Tabs.Screen
        name="Today"
        component={TodayScreen}
        options={{
          title: 'Today',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>●</Text>,
        }}
      />
      <Tabs.Screen
        name="History"
        component={HistoryScreen}
        options={{
          title: 'History',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>◷</Text>,
        }}
      />
      <Tabs.Screen
        name="RosterTab"
        component={RosterListScreen}
        options={{
          title: 'Roster',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 20 }}>☰</Text>,
        }}
      />
    </Tabs.Navigator>
  );
}

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
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen
              name="PersonForm"
              component={PersonFormScreen}
              options={({ route }) => ({
                headerShown: true,
                title: route.params?.person ? 'Edit person' : 'Add person',
                headerBackTitle: 'Back',
              })}
            />
            <Stack.Screen
              name="Camera"
              component={CameraScreen}
              options={{ animation: 'slide_from_bottom' }}
            />
            <Stack.Screen
              name="Export"
              component={ExportScreen}
              options={{ headerShown: true, title: 'Export', headerBackTitle: 'Back' }}
            />
          </>
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
