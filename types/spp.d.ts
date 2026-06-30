// The forked-SPP WASM prover is vendored/published as `@trexure/spp` and is
// lazy-loaded at runtime (absent → labeled AES-wrap fallback in lib/zk). Declared
// here so the dynamic `import("@trexure/spp")` typechecks before the fork is wired.
declare module "@trexure/spp";
