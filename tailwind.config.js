export default {
  content: [
    './*.html',
    './js/**/*.js',
  ],
  theme: {
    extend: {
      colors: {
        ink: '#0B1F3A',
        gold: '#D4AF37',
        flame: '#E63946',
        pitch: '#0E7C3A',
        night: '#081428',
      },
      fontFamily: {
        display: ['"Inter"', '"PingFang SC"', '"Microsoft YaHei"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 4px 20px rgba(11, 31, 58, 0.08)',
        cardHover: '0 8px 30px rgba(11, 31, 58, 0.16)',
      },
      animation: {
        'pulse-slow': 'pulse 2.4s ease-in-out infinite',
        'fade-in': 'fadeIn 0.4s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: 0, transform: 'translateY(8px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
