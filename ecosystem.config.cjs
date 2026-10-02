module.exports = {
  apps: [
    {
      name: "screener-web",
      cwd: __dirname,
      script: "node_modules/next/dist/bin/next",
      args: "start",
      env: { PORT: process.env.PORT || "3100" },
    },
    {
      name: "screener-worker",
      cwd: __dirname,
      script: "npm",
      args: "run worker",
      // The worker waits up to 30s for in-flight work before it exits.
      kill_timeout: 35000,
    },
  ],
};
