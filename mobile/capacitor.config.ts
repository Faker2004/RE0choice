import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.re0choice.radar",
  appName: "RE0 Radar",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
