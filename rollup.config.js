import esbuild from 'rollup-plugin-esbuild';
import commonjs from '@rollup/plugin-commonjs';
import nodeResolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import serve from 'rollup-plugin-serve';
import json from '@rollup/plugin-json';

const dev = process.env.ROLLUP_WATCH;

const serveopts = {
  contentBase: ['./dist'],
  host: '0.0.0.0',
  port: 5002,
  allowCrossOrigin: true,
  headers: {
    'Access-Control-Allow-Origin': '*',
  },
};

const plugins = [nodeResolve(), commonjs(), esbuild({ target: 'es2022' }), json(), dev && serve(serveopts), !dev && terser()];

const onwarn = (warning, warn) => {
  if (warning.code === 'THIS_IS_UNDEFINED' && warning.id?.includes('/node_modules/')) {
    return;
  }

  warn(warning);
};

export default [
  {
    input: 'src/card/vasttrafik-card.ts',
    output: {
      file: 'dist/vasttrafik-home-assistant-card.js',
      format: 'es',
      inlineDynamicImports: true,
    },
    plugins: [...plugins.filter(Boolean)],
    onwarn,
  },
];
