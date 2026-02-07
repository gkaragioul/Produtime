const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const webpack = require("webpack");
const WebpackObfuscator = require("webpack-obfuscator");

module.exports = {
  entry: "./src/renderer/index.tsx",
  // Use a pure web target so webpack bundles browser-friendly code without assuming Node 'require'
  target: "web",
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: {
          loader: "ts-loader",
          options: {
            configFile: "tsconfig.webpack.json",
          },
        },
        exclude: [/node_modules/, /\.test\.tsx?$/, /\.spec\.tsx?$/],
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
      },
      {
        test: /\.(png|jpe?g|gif|svg|ico)$/i,
        type: "asset/resource",
        generator: {
          filename: "assets/[name][ext]",
        },
      },
    ],
  },
  resolve: {
    extensions: [".tsx", ".ts", ".js"],
    // Polyfill Node core modules that some dev tooling (like webpack-dev-server client) expects
    fallback: {
      events: require.resolve("events/"),
      buffer: require.resolve("buffer/"),
      process: require.resolve("process/browser"),
      path: false, // not needed in renderer right now
      fs: false, // avoid bundling server-only modules
    },
  },
  output: {
    filename: "bundle.js",
    path: path.resolve(__dirname, "dist/renderer"),
    clean: false,
    // Explicit uniqueName so webpack doesn't need to parse package.json
    uniqueName: "produtime",
  },
  plugins: [
    // HtmlWebpackPlugin disabled due to localStorage error
    // Using copy-webpack-plugin instead
    // new HtmlWebpackPlugin({
    //   template: "./src/renderer/index.html",
    //   minify: false,
    //   inject: "body",
    //   scriptLoading: "defer",
    // }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: "src/renderer/index.html",
          to: "index.html",
        },
      ],
    }),
    new webpack.DefinePlugin({
      global: "globalThis",
    }),
    new webpack.ProvidePlugin({
      process: "process/browser",
      Buffer: ["buffer", "Buffer"],
    }),
    // Code obfuscation for production builds
    ...(process.env.NODE_ENV === "production"
      ? [
          new WebpackObfuscator(
            {
              rotateStringArray: true,
              stringArray: true,
              stringArrayThreshold: 0.75,
              transformObjectKeys: true,
              unicodeEscapeSequence: false,
              compact: true,
              controlFlowFlattening: true,
              controlFlowFlatteningThreshold: 0.75,
              deadCodeInjection: true,
              deadCodeInjectionThreshold: 0.4,
              debugProtection: false,
              disableConsoleOutput: false,
              identifierNamesGenerator: "hexadecimal",
              renameGlobals: false,
              selfDefending: true,
              splitStrings: true,
              splitStringsChunkLength: 10,
            },
            ["bundle.js"]
          ),
        ]
      : []),
  ],
};
