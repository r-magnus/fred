/**
 * The hint that there is more of the chat below, and the way to it (#184).
 *
 * Made to look passing, not like a control that lives there: a small leaf-green
 * drop with no outline, a little see-through, that drifts in, bobs like
 * something floating, and fades out again once the reader is near the end.
 * With the phone's "remove animations" setting on it only fades.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, Pressable, StyleSheet, View } from 'react-native';
import { useReduceMotion } from './motion.ts';
import { useThemed, type Palette } from './theme.tsx';

const ARROW = require('../assets/ui/arrow-up.png');

export function JumpToEnd({ shown, onPress }: { shown: boolean; onPress: () => void }): React.JSX.Element {
  const { styles } = useThemed(makeStyles);
  const still = useReduceMotion();
  const appear = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(appear, {
      toValue: shown ? 1 : 0, duration: shown ? 260 : 180,
      easing: shown ? Easing.out(Easing.cubic) : Easing.in(Easing.quad), useNativeDriver: true,
    }).start();
  }, [shown, appear]);

  useEffect(() => {
    if (!shown || still) { bob.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(bob, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(bob, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [shown, still, bob]);

  return (
    // A zero-height row between the chat and the composer; the drop hangs up into the chat.
    <View style={styles.row} pointerEvents={shown ? 'box-none' : 'none'}>
      <Animated.View style={[styles.float, {
        opacity: appear.interpolate({ inputRange: [0, 1], outputRange: [0, 0.88] }),
        transform: [
          { translateY: still ? 0 : appear.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
          { translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, 3] }) },
        ],
      }]}>
        <Pressable style={styles.drop} onPress={onPress} hitSlop={12}
          accessibilityRole="button" accessibilityLabel="Jump to the end">
          <Image source={ARROW} resizeMode="contain" style={styles.mark} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  row: { height: 0, alignItems: 'center', zIndex: 2 },
  float: { position: 'absolute', bottom: 10 },
  // The green of Fred's own tabs, so it reads as Fred's and not as a button of the phone's.
  drop: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.sage, boxShadow: `0 2 10 ${palette.shade}`,
  },
  mark: { width: 14, height: 14, tintColor: palette.pine, transform: [{ rotate: '180deg' }] },
});
