import { defineStore } from 'pinia'
export const usePreferences = defineStore('preferences', {
  state: () => ({ textOnly: false, lowData: false, reducedMotion: false, showAllText: true }),
  actions: {
    restore() {
      try {
        const saved = JSON.parse(localStorage.getItem('careerscape-preferences') || '{}')
        for (const key of ['textOnly', 'lowData', 'reducedMotion', 'showAllText'] as const)
          if (typeof saved[key] === 'boolean') this[key] = saved[key]
      } catch {
        /* preferences are optional */
      }
    },
    save() {
      localStorage.setItem('careerscape-preferences', JSON.stringify(this.$state))
    },
  },
})
