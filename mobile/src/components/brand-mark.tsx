import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, Keyboard, useWindowDimensions, View } from "react-native";

const MARK = require("../../assets/az-monogram.png");
const RATIO = 640 / 352; // width / height of the artwork
const LOGO_WIDTH = 140;  // points

// "AZ AI" stays dark but its colour slowly drifts between two deep tones (navy and ink blue), so it looks alive without being distracting.
const DARK_A = "#0b1530", DARK_B = "#123a8f";

/**
 * The A-Zee "AZ" monogram, 140 points wide, with a bold 14 point "AZ AI" directly under it, for the top of the sign-in page.
 * It shrinks on short screens and while the keyboard is open so the form always has room, and has a transparent background so it sits
 * on the light or dark page alike.
 */
export function BrandMark({ align = "center" }: { align?: "center" | "flex-start" }) {
  const { width, height } = useWindowDimensions();
  const [typing, setTyping] = useState(false);
  const drift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setTyping(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setTyping(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(drift, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      Animated.timing(drift, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [drift]);
  const color = drift.interpolate({ inputRange: [0, 1], outputRange: [DARK_A, DARK_B] });
  const w = typing || height < 620 ? Math.round(LOGO_WIDTH * 0.6) : Math.min(LOGO_WIDTH, Math.round(width * 0.7));
  return (
    <View style={{ alignItems: align, marginTop: typing ? 0 : -28, marginBottom: typing ? 8 : 18 }}>
      <Image source={MARK} accessibilityRole="image" accessibilityLabel="A-Zee" resizeMode="contain" style={{ width: w, height: w / RATIO }} />
      <Animated.Text style={{ color, fontSize: 14, fontWeight: "700", lineHeight: 16, marginTop: 0, textAlign: "center" }}>AZ AI</Animated.Text>
    </View>
  );
}
