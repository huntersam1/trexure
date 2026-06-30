// Next.js 16 ships a native flat ESLint config (an array of Linter.Config),
// so we spread it directly rather than going through FlatCompat.
import next from "eslint-config-next";

const eslintConfig = [
  ...next,
  {
    ignores: ["lib/generated/**", ".next/**", "dist/**", "node_modules/**"],
  },
];

export default eslintConfig;
