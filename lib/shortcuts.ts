export const MOD = "mod" as const;

export type Shortcut = { keys: string[]; label: string };
export type ShortcutGroup = { title: string; shortcuts: Shortcut[] };

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Cards",
    shortcuts: [
      { keys: [MOD, "O"], label: "Open the hovered card" },
      { keys: [MOD, "R"], label: "Regenerate the hovered card" },
      { keys: ["Delete"], label: "Delete the selected cards" },
      { keys: ["Esc"], label: "Close the open card" },
    ],
  },
  {
    title: "Moving through the graph",
    shortcuts: [
      { keys: ["↑"], label: "Go to the card this one branches from" },
      { keys: ["↓"], label: "Go to the first card branching off this one" },
      { keys: ["←"], label: "Go to the previous branch at this depth" },
      { keys: ["→"], label: "Go to the next branch at this depth" },
    ],
  },
  {
    title: "Composer",
    shortcuts: [
      { keys: ["Enter"], label: "Send the prompt" },
      { keys: ["Shift", "Enter"], label: "Start a new line" },
      { keys: ["Esc"], label: "Cancel a staged regeneration" },
    ],
  },
  {
    title: "Help",
    shortcuts: [{ keys: [MOD, "/"], label: "Show this list" }],
  },
];

export function modifierLabel(): string {
  const isApple =
    typeof navigator !== "undefined" &&
    /mac|iphone|ipad|ipod/i.test(navigator.userAgent);
  return isApple ? "⌘" : "Ctrl";
}
