const path = require('path')
const CaseSensitivePathsPlugin = require('case-sensitive-paths-webpack-plugin')
const CircularDependencyPlugin = require('circular-dependency-plugin')
const { CleanWebpackPlugin } = require('clean-webpack-plugin')
const autoprefixer = require('autoprefixer')
const HtmlWebpackPlugin = require('html-webpack-plugin')

module.exports = function (env, args) {
  const outDir = path.join(__dirname, 'out')
  const nodeModulesDir = path.join(__dirname, 'node_modules')
  const srcDir = path.join(__dirname, 'src')

  return {
    entry: { index: path.join(srcDir, 'index.js') },
    output: { filename: '[name].js', path: outDir },
    devtool: 'source-map',
    devServer: { static: outDir, hot: true },
    plugins: [
      new CleanWebpackPlugin(),
      new CaseSensitivePathsPlugin(),
      new CircularDependencyPlugin({ exclude: /node_modules/, failOnError: true, allowAsyncCycles: false }),
      new HtmlWebpackPlugin({ template: path.join(srcDir, 'index.html') })
    ],
    module: {
      rules: [
        {
          test: /(\.js|\.cjs)$/,
          use: { loader: 'babel-loader' },
          exclude: [path.resolve(nodeModulesDir)],
          include: [
            path.resolve(srcDir)
          ]
        },
        {
          test: /\.(scss)$/,
          use: [
            { loader: 'style-loader' },
            { loader: 'css-loader' },
            {
              loader: 'postcss-loader',
              options: {
                postcssOptions: {
                  plugins: [autoprefixer]
                }
              }
            },
            {
              loader: 'sass-loader',
              options: {
                sassOptions: { quietDeps: true }
              }
            }
          ]
        }
      ]
    },
    resolve: {
      extensions: [
        '.cjs',
        '.js',
        '.json'
      ]
    },
    optimization: {
      runtimeChunk: 'single'
    }
  }
}
