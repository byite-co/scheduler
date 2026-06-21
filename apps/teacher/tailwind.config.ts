import type { Config } from "tailwindcss";

import designTokens from "@ssamplanner/design-tokens/tailwind";

const config = {
  content: ["./src/app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: designTokens.colors,
      borderRadius: designTokens.borderRadius,
      fontFamily: designTokens.fontFamily
    }
  },
  plugins: []
} satisfies Config;

export default config;
