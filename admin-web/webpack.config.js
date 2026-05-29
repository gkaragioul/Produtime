const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  mode: process.env.NODE_ENV || 'development',
  entry: './src/client/index.tsx',
  target: 'web',  // Web target, not electron-renderer
  output: {
    path: path.resolve(__dirname, 'dist/client'),
    filename: 'bundle.js',
    publicPath: '/',
    assetModuleFilename: 'assets/[name][ext]',
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: {
          loader: 'ts-loader',
          options: {
            configFile: path.resolve(__dirname, 'tsconfig.json'),
          },
        },
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.(png|jpg|jpeg|gif|ico|svg)$/i,
        type: 'asset/resource',
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/client/index.html',
    }),
    new CopyPlugin({
      patterns: [
        { from: './assets/PTAdminIcon.png', to: 'assets/' },
        { from: './src/client/manifest.webmanifest', to: 'manifest.webmanifest' },
      ],
    }),
  ],
};
