import { useEffect, useState } from "react";
import { Image, Keyboard, useWindowDimensions, View } from "react-native";

const MARK = require("../../assets/az-monogram.png");
const RATIO = 640 / 352; // width / height of the artwork

/**
 * The A-Zee "AZ" monogram for the top of the sign-in page. It scales with the screen (about a quarter of the width, never larger
 * than 132 or smaller than 84 points), shrinks on short screens and while the keyboard is open so the form always has room,
 * and has a transparent background so it sits on the light or dark page alike.
 */
export function BrandMark({ align = "center" }: { align?: "center" | "flex-start" }) {
  const { width, height } = useWindowDimensions();
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setTyping(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setTyping(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const base = Math.max(84, Math.min(132, width * 0.26));
  const w = typing || height < 620 ? Math.round(base * 0.6) : Math.round(base);
  return (
    <View style={{ alignItems: align, marginBottom: typing ? 8 : 18 }}>
      <Image source={MARK} accessibilityRole="image" accessibilityLabel="A-Zee" resizeMode="contain" style={{ width: w, height: w / RATIO }} />
    </View>
  );
}
