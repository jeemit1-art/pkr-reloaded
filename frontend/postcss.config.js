// Compile every imported CSS file, including Tailwind output, in its original
// cascade position. No separately imported mirror of an old theme.
module.exports = {plugins:{tailwindcss:{},[require.resolve('./scripts/compile-personal-theme.cjs')]:{},autoprefixer:{}}};
