export const SIDEBAR_COLLAPSED_COOKIE = "sidebar_collapsed";
export const SKILLS_SECTION = "skills";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

// Keys are "skills" or folder ids, none of which contain a comma.
export function parseCollapsedSections(value: string | undefined): string[] {
  return value ? value.split(",").filter(Boolean) : [];
}

export function persistCollapsedSections(keys: Iterable<string>) {
  document.cookie = `${SIDEBAR_COLLAPSED_COOKIE}=${[...keys].join(",")}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}
