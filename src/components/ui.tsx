import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { theme } from '../theme';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  const bg = {
    primary: theme.colors.primary,
    secondary: theme.colors.cardAlt,
    danger: theme.colors.danger,
    ghost: 'transparent',
  }[variant];
  const fg =
    variant === 'primary'
      ? theme.colors.primaryText
      : variant === 'ghost'
      ? theme.colors.textMuted
      : theme.colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === 'ghost' && styles.ghostBorder,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Field(props: TextInputProps & { label?: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={{ marginBottom: theme.spacing(1.5) }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={theme.colors.textMuted}
        style={[styles.input, style]}
        {...rest}
      />
    </View>
  );
}

export function ScreenTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.screenTitle}>{children}</Text>;
}

export function Empty({ text }: { text: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing(2),
  },
  ghostBorder: {
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  buttonText: { fontSize: 17, fontWeight: '700' },
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.md,
    padding: theme.spacing(2),
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  label: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    backgroundColor: theme.colors.cardAlt,
    color: theme.colors.text,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing(1.5),
    paddingVertical: theme.spacing(1.5),
    fontSize: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  screenTitle: {
    color: theme.colors.text,
    fontSize: 28,
    fontWeight: '800',
    marginBottom: theme.spacing(2),
  },
  empty: { padding: theme.spacing(4), alignItems: 'center' },
  emptyText: { color: theme.colors.textMuted, fontSize: 15, textAlign: 'center' },
});
