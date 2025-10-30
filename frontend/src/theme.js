import { createTheme } from '@mui/material/styles';

export const lightTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#2563eb', // blue-600
      light: '#3b82f6', // blue-500
      dark: '#1d4ed8', // blue-700
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#4f46e5', // indigo-600
      light: '#6366f1', // indigo-500
      dark: '#4338ca', // indigo-700
    },
    background: {
      default: '#f8fafc', // slate-50
      paper: '#ffffff',
    },
    text: {
      primary: '#1e293b', // slate-800
      secondary: '#475569', // slate-600
    },
  },
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#ffffff',
          color: '#1e293b',
        },
      },
    },
  },
});

export const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#60a5fa', // blue-400
      light: '#93c5fd', // blue-300
      dark: '#3b82f6', // blue-500
      contrastText: '#0f172a', // slate-900
    },
    secondary: {
      main: '#818cf8', // indigo-400
      light: '#a5b4fc', // indigo-300
      dark: '#6366f1', // indigo-500
    },
    background: {
      default: '#0f172a', // slate-900
      paper: '#1e293b', // slate-800
    },
    text: {
      primary: '#f8fafc', // slate-50
      secondary: '#cbd5e1', // slate-400
    },
  },
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#1e293b', // slate-800
          color: '#f8fafc', // slate-50
        },
      },
    },
  },
});
