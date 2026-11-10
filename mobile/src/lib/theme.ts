import { useColorScheme } from "react-native";

// Colors follow the system light/dark setting, matching the A-Zee web app's green accent.

export type Theme = {
  bg: string; card: string; ink: string; muted: string; line: string;
  accent: string; accentInk: string; danger: string; bubbleUser: string; bubbleUserInk: string; bubbleAi: string;
};

const light: Theme = {
  bg: "#f7f6f3", card: "#ffffff", ink: "#17201c", muted: "#66736c", line: "#e3e8e4",
  accent: "#047857", accentInk: "#ffffff", danger: "#b91c1c", bubbleUser: "#047857", bubbleUserInk: "#ffffff", bubbleAi: "#ffffff",
};
const dark: Theme = {
  bg: "#101412", card: "#181d1a", ink: "#e6ede9", muted: "#93a09a", line: "#2a312d",
  accent: "#34d399", accentInk: "#06281d", danger: "#f87171", bubbleUser: "#0f5f47", bubbleUserInk: "#ffffff", bubbleAi: "#1d2420",
};

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}

/** At this width and above (tablets, and phones turned sideways) screens use a two-pane layout. */
export const TABLET_WIDTH = 720;
