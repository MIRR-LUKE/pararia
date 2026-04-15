import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const config = [
  {
    ignores: [
      ".data/**",
      ".next/**",
      ".tmp/**",
      "artifacts/**",
      "node_modules/**",
    ],
  },
  ...nextCoreWebVitals,
  {
    rules: {
      "react/jsx-key": "off",
    },
  },
];

export default config;
