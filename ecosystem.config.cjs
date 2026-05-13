module.exports = {
  apps: [
    {
      name: "dosbox",
      script: "node_modules/.bin/react-router-serve",
      args: "./build/server/index.js",
      cwd: "/home/gcjjyy/dosbox",
      env: {
        PORT: "5301",
        DOS_ROOT: "/home/gcjjyy/dos",
        NODE_ENV: "production",
      },
      env_file: "/home/gcjjyy/dosbox/.env",
      max_memory_restart: "512M",
      restart_delay: 3000,
    },
  ],
};
