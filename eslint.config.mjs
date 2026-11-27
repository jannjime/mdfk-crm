import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "dist/**",
      "drizzle/**",
      "scripts/**",
      // 080: el puente QR es un servicio aparte, con su propio typecheck y pruebas.
      "puente-qr/**",
      "next-env.d.ts",
      ".tmp-seed-demo.mjs",
      ".tmp-*.mjs",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default config;
