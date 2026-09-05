module.exports = {
  apps: [
    {
      name: "roadwise",
      script: "./server.mjs",
      cwd: __dirname,
      interpreter: "node",
      node_args: "--env-file=.env",
      env: {
        NODE_ENV: "production",
        PORT: 3000
      },
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",
      time: true
    }
  ]
};
