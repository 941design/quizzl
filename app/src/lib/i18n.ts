import type { LanguageCode } from '@/src/types';

type Copy = {
  appName: string;
  languageNames: Record<LanguageCode, string>;
  layout: {
    nav: {
      home: string;
      topics: string;
      leaderboard: string;
      studyTimes: string;
      settings: string;
    };
    languageLabel: string;
    mobileMenuLabel: string;
    profileFallbackName: string;
  };
  home: {
    title: string;
    description: string;
    browseTopics: string;
    settings: string;
    profileCardTitle: string;
    profileCardBody: string;
    featureQuiz: string;
    featureQuizBody: string;
    featureNotes: string;
    featureNotesBody: string;
    featurePlan: string;
    featurePlanBody: string;
  };
  topics: {
    pageTitle: string;
    heading: string;
    description: string;
    allTopics: (count: number) => string;
    myTopics: (count?: number) => string;
    emptyHeading: string;
    emptyBody: string;
    browseAll: string;
    select: string;
    remove: string;
    studyNow: string;
  };
  topicPage: {
    notFoundTitle: string;
    notFoundHeading: string;
    notFoundBody: string;
    browseTopics: string;
    quizLabel: string;
    answeredStat: (answered: number, total: number) => string;
    pointsLabel: string;
    tabs: {
      quiz: string;
      notes: string;
      studyPlan: string;
    };
  };
  settings: {
    pageTitle: string;
    heading: string;
    description: string;
    resetSuccess: string;
    profileSaved: string;
    profileHeading: string;
    profileDescription: string;
    nicknameHeading: string;
    nicknameDescription: string;
    nicknamePlaceholder: string;
    nicknameHelper: string;
    avatarHeading: string;
    avatarDescription: string;
    chooseAvatar: string;
    changeAvatar: string;
    removeAvatar: string;
    noAvatarSelected: string;
    badgesHeading: string;
    badgesDescription: string;
    badgesSelected: (count: number, limit: number) => string;
    saveProfile: string;
    avatarModalTitle: string;
    avatarModalDescription: string;
    avatarSubjectLabel: string;
    avatarAccessoryLabel: string;
    clearFilters: string;
    avatarResults: (count: number) => string;
    avatarNoResults: string;
    avatarNoAccessories: string;
    useThisAvatar: string;
    showMoreAvatars: string;
    languageHeading: string;
    languageDescription: string;
    themeHeading: string;
    themeDescription: string;
    calm: string;
    playful: string;
    lego: string;
    minecraft: string;
    active: string;
    currentTheme: string;
    calmDescription: string;
    playfulDescription: string;
    legoDescription: string;
    minecraftDescription: string;
    resetHeading: string;
    resetDescription: string;
    resetButton: string;
    resetModalTitle: string;
    resetModalBody: string;
    cancel: string;
    confirmReset: string;
  };
  leaderboard: {
    pageTitle: string;
    heading: string;
    description: string;
    profileHeading: string;
    noTopics: string;
    browseTopics: string;
    noPoints: string;
    youLabel: string;
    totalPoints: string;
    rank: string;
    streak: string;
    streakDay: string;
    streakDays: string;
    onARoll: string;
    topicsSelected: string;
    loading: string;
    youBadge: string;
    pointsUnit: string;
  };
  studyTimes: {
    pageTitle: string;
    heading: string;
    description: string;
    recentSessions: string;
    loading: string;
    today: string;
    thisWeek: string;
    totalSessions: string;
    studyTime: string;
    completed: string;
    noSessions: string;
    noSessionsBody: string;
    general: string;
  };
  quiz: {
    emptyHeading: string;
    emptyBody: string;
    completeHeading: string;
    answeredSummary: (count: number) => string;
    retry: string;
    questionProgress: (current: number, total: number) => string;
    scoreProgress: (answered: number, total: number, points: number) => string;
    singleChoice: string;
    multiChoice: string;
    flashcard: string;
    previous: string;
    next: string;
    correct: string;
    incorrect: string;
    selectAll: string;
    submitAnswer: string;
    scoreLabel: (score: number) => string;
    flashcardQuestion: string;
    flashcardAnswer: string;
    revealAnswer: string;
    didntKnow: string;
    knewIt: string;
    knewItFeedback: string;
    didntKnowFeedback: string;
  };
  notes: {
    saving: string;
    saved: string;
    unsaved: string;
    autoSave: string;
  };
  studyPlan: {
    done: string;
    completeTask: (title: string) => string;
    emptyHeading: string;
    emptyBody: string;
    overallProgress: string;
    tasksCompleted: (completed: number, total: number) => string;
  };
  studyTimer: {
    activeSessionTitle: string;
    activeSessionBody: string;
    continue: string;
    stop: string;
    startSession: string;
    stopSession: string;
  };
  storage: {
    title: string;
    description: string;
    dismiss: string;
  };
};

export function normalizeLanguage(input?: string | null): LanguageCode {
  if (!input) return 'en';
  return input.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export function detectBrowserLanguage(): LanguageCode {
  if (typeof navigator === 'undefined') return 'en';
  return normalizeLanguage(navigator.language);
}

const copy: Record<LanguageCode, Copy> = {
  en: {
    appName: 'Quizzl',
    languageNames: { en: 'English', de: 'Deutsch' },
    layout: {
      nav: {
        home: 'Home',
        topics: 'Topics',
        leaderboard: 'Leaderboard',
        studyTimes: 'Study Times',
        settings: 'Settings',
      },
      languageLabel: 'Language',
      mobileMenuLabel: 'Toggle navigation menu',
      profileFallbackName: 'Player One',
    },
    home: {
      title: 'Welcome to Quizzl',
      description:
        'Learn with freely selectable topics. Combine quiz, notes, and study plans to master any subject at your own pace.',
      browseTopics: 'Browse Topics',
      settings: 'Settings',
      profileCardTitle: 'Your learning profile',
      profileCardBody: 'Your nickname and avatar show up in progress spaces like the leaderboard.',
      featureQuiz: 'Quiz & Flashcards',
      featureQuizBody:
        'Test your knowledge with single-choice, multi-choice, and flashcard questions.',
      featureNotes: 'Notes',
      featureNotesBody: 'Write rich formatted notes per topic. Auto-saved to your browser.',
      featurePlan: 'Study Plans',
      featurePlanBody: 'Follow structured study steps and track your daily progress.',
    },
    topics: {
      pageTitle: 'Topics',
      heading: 'Topics',
      description: 'Select topics you want to learn. Your selections are saved automatically.',
      allTopics: (count) => `All Topics (${count})`,
      myTopics: (count) => (typeof count === 'number' ? `My Topics (${count})` : 'My Topics'),
      emptyHeading: "You haven't selected any topics yet.",
      emptyBody: 'Go to "All Topics" and click "Select" on any topic to get started.',
      browseAll: 'Browse All Topics',
      select: 'Select',
      remove: 'Remove',
      studyNow: 'Study Now',
    },
    topicPage: {
      notFoundTitle: 'Topic Not Found',
      notFoundHeading: 'Topic not found',
      notFoundBody: "This topic doesn't exist or failed to load.",
      browseTopics: 'Browse Topics',
      quizLabel: 'Quiz',
      answeredStat: (answered, total) => `${answered}/${total} answered`,
      pointsLabel: 'Points',
      tabs: {
        quiz: 'Quiz',
        notes: 'Notes',
        studyPlan: 'Study Plan',
      },
    },
    settings: {
      pageTitle: 'Settings',
      heading: 'Settings',
      description: 'Customize your learning experience.',
      resetSuccess: 'All data has been reset. Start fresh!',
      profileSaved: 'Your profile look has been saved.',
      profileHeading: 'My Profile',
      profileDescription: 'Pick a nickname, an avatar, and a few fun badges.',
      nicknameHeading: 'Nickname',
      nicknameDescription: 'Choose a short nickname that feels like you.',
      nicknamePlaceholder: 'Rocket Reader',
      nicknameHelper: 'Use a nickname instead of your full real name.',
      avatarHeading: 'Avatar',
      avatarDescription: 'Pick a fruit friend for your profile.',
      chooseAvatar: 'Choose Avatar',
      changeAvatar: 'Change Avatar',
      removeAvatar: 'Remove Avatar',
      noAvatarSelected: 'No avatar picked yet.',
      badgesHeading: 'Badges',
      badgesDescription: 'Choose up to 3 badges that show your style.',
      badgesSelected: (count, limit) => `${count}/${limit} badges selected`,
      saveProfile: 'Save Profile',
      avatarModalTitle: 'Choose Your Avatar',
      avatarModalDescription: 'Pick a fruit, add accessories if you want, and choose a favorite.',
      avatarSubjectLabel: 'Fruit friend',
      avatarAccessoryLabel: 'Accessories',
      clearFilters: 'Clear filters',
      avatarResults: (count) => `${count} avatar${count !== 1 ? 's' : ''}`,
      avatarNoResults: 'No avatars match those filters yet. Try fewer accessories.',
      avatarNoAccessories: 'No accessories',
      useThisAvatar: 'Use This Avatar',
      showMoreAvatars: 'Show More',
      languageHeading: 'Language',
      languageDescription: 'Choose which language the app and content catalogue should use.',
      themeHeading: 'Theme',
      themeDescription: 'Choose the visual theme for the app.',
      calm: 'Calm',
      playful: 'Playful',
      lego: 'Brick Builder',
      minecraft: 'Block World',
      active: 'Active',
      currentTheme: 'Current theme',
      calmDescription: 'Muted blues and greens, minimal animations.',
      playfulDescription: 'Warm oranges and purples, rounded corners.',
      legoDescription: 'Bold brick colors, toy-like contrast, and a stud-patterned background.',
      minecraftDescription: 'Earthy block tones, squared surfaces, and a pixelated backdrop.',
      resetHeading: 'Reset All Data',
      resetDescription:
        'Clear all your progress, notes, study sessions, and settings. This cannot be undone.',
      resetButton: 'Reset All Data',
      resetModalTitle: 'Reset All Data?',
      resetModalBody:
        'This will permanently delete all your quiz answers, notes, study sessions, and settings. This action cannot be undone.',
      cancel: 'Cancel',
      confirmReset: 'Yes, Reset Everything',
    },
    leaderboard: {
      pageTitle: 'Leaderboard',
      heading: 'Leaderboard',
      description: 'Your learning progress. Keep studying to climb the ranks!',
      profileHeading: 'Your profile',
      noTopics: 'Select some topics to track your quiz points.',
      browseTopics: 'Browse Topics',
      noPoints: 'Complete some quiz questions to earn points and appear on the leaderboard.',
      youLabel: 'You (1/1)',
      totalPoints: 'Total Points',
      rank: 'Rank',
      streak: 'Study Streak',
      streakDay: 'day',
      streakDays: 'days',
      onARoll: 'On a roll!',
      topicsSelected: 'Topics Selected',
      loading: 'Loading...',
      youBadge: 'You',
      pointsUnit: 'pts',
    },
    studyTimes: {
      pageTitle: 'Study Times',
      heading: 'Study Times',
      description: 'Track your study sessions and see your progress over time.',
      recentSessions: 'Recent Sessions',
      loading: 'Loading...',
      today: 'Today',
      thisWeek: 'This Week',
      totalSessions: 'Total Sessions',
      studyTime: 'study time',
      completed: 'completed',
      noSessions: 'No study sessions yet.',
      noSessionsBody: 'Start a session on a topic page to track your study time.',
      general: 'General',
    },
    quiz: {
      emptyHeading: 'This topic has no quiz questions yet.',
      emptyBody: 'Try the Notes or Study Plan tabs to continue learning.',
      completeHeading: 'Quiz Complete!',
      answeredSummary: (count) => `${count} question${count !== 1 ? 's' : ''} answered`,
      retry: 'Retry Quiz',
      questionProgress: (current, total) => `Question ${current} of ${total}`,
      scoreProgress: (answered, total, points) => `${answered}/${total} answered · ${points} pts`,
      singleChoice: 'Single Choice',
      multiChoice: 'Multiple Choice',
      flashcard: 'Flashcard',
      previous: 'Previous',
      next: 'Next',
      correct: 'Correct!',
      incorrect: 'Incorrect',
      selectAll: 'Select all that apply',
      submitAnswer: 'Submit Answer',
      scoreLabel: (score) => `Score: ${score} point${score !== 1 ? 's' : ''}`,
      flashcardQuestion: 'Question',
      flashcardAnswer: 'Answer',
      revealAnswer: 'Reveal Answer',
      didntKnow: "I didn't know it",
      knewIt: 'I knew it!',
      knewItFeedback: 'You knew it! +1 point',
      didntKnowFeedback: "You didn't know it. Keep studying!",
    },
    notes: {
      saving: 'Saving...',
      saved: 'Saved',
      unsaved: 'Unsaved',
      autoSave: 'Notes are saved automatically to your browser.',
    },
    studyPlan: {
      done: 'Done',
      completeTask: (title) => `Complete: ${title}`,
      emptyHeading: 'This topic has no study plan yet.',
      emptyBody: 'Try the Quiz or Notes tabs to continue learning.',
      overallProgress: 'Overall progress',
      tasksCompleted: (completed, total) => `${completed}/${total} tasks completed`,
    },
    studyTimer: {
      activeSessionTitle: 'Active study session detected',
      activeSessionBody:
        'You may have refreshed during a session. Would you like to continue or stop it?',
      continue: 'Continue',
      stop: 'Stop',
      startSession: 'Start Session',
      stopSession: 'Stop Session',
    },
    storage: {
      title: 'Storage Unavailable',
      description:
        "Your browser's local storage is not available (private mode?). The app will work, but your progress and settings won't be saved between sessions.",
      dismiss: 'Dismiss warning',
    },
  },
  de: {
    appName: 'Quizzl',
    languageNames: { en: 'English', de: 'Deutsch' },
    layout: {
      nav: {
        home: 'Start',
        topics: 'Themen',
        leaderboard: 'Rangliste',
        studyTimes: 'Lernzeiten',
        settings: 'Einstellungen',
      },
      languageLabel: 'Sprache',
      mobileMenuLabel: 'Navigationsmenü umschalten',
      profileFallbackName: 'Spieler Eins',
    },
    home: {
      title: 'Willkommen bei Quizzl',
      description:
        'Lerne mit frei wählbaren Themen. Kombiniere Quiz, Notizen und Lernpläne, um jedes Fach in deinem eigenen Tempo zu meistern.',
      browseTopics: 'Themen ansehen',
      settings: 'Einstellungen',
      profileCardTitle: 'Dein Lernprofil',
      profileCardBody: 'Dein Spitzname und Avatar erscheinen in Fortschrittsbereichen wie der Rangliste.',
      featureQuiz: 'Quiz & Karteikarten',
      featureQuizBody:
        'Teste dein Wissen mit Single-Choice-, Multiple-Choice- und Karteikarten-Fragen.',
      featureNotes: 'Notizen',
      featureNotesBody: 'Schreibe formatierte Notizen pro Thema. Automatisch im Browser gespeichert.',
      featurePlan: 'Lernpläne',
      featurePlanBody: 'Folge strukturierten Lernschritten und verfolge deinen Fortschritt.',
    },
    topics: {
      pageTitle: 'Themen',
      heading: 'Themen',
      description: 'Wähle Themen aus, die du lernen möchtest. Deine Auswahl wird automatisch gespeichert.',
      allTopics: (count) => `Alle Themen (${count})`,
      myTopics: (count) => (typeof count === 'number' ? `Meine Themen (${count})` : 'Meine Themen'),
      emptyHeading: 'Du hast noch keine Themen ausgewählt.',
      emptyBody: 'Wechsle zu "Alle Themen" und klicke bei einem Thema auf "Auswählen".',
      browseAll: 'Alle Themen ansehen',
      select: 'Auswählen',
      remove: 'Entfernen',
      studyNow: 'Jetzt lernen',
    },
    topicPage: {
      notFoundTitle: 'Thema nicht gefunden',
      notFoundHeading: 'Thema nicht gefunden',
      notFoundBody: 'Dieses Thema existiert nicht oder konnte nicht geladen werden.',
      browseTopics: 'Themen ansehen',
      quizLabel: 'Quiz',
      answeredStat: (answered, total) => `${answered}/${total} beantwortet`,
      pointsLabel: 'Punkte',
      tabs: {
        quiz: 'Quiz',
        notes: 'Notizen',
        studyPlan: 'Lernplan',
      },
    },
    settings: {
      pageTitle: 'Einstellungen',
      heading: 'Einstellungen',
      description: 'Passe dein Lernerlebnis an.',
      resetSuccess: 'Alle Daten wurden zurückgesetzt. Du kannst neu starten.',
      profileSaved: 'Dein Profil wurde gespeichert.',
      profileHeading: 'Mein Profil',
      profileDescription: 'Wähle einen Spitznamen, einen Avatar und ein paar lustige Badges.',
      nicknameHeading: 'Spitzname',
      nicknameDescription: 'Wähle einen kurzen Namen, der zu dir passt.',
      nicknamePlaceholder: 'Raketenleser',
      nicknameHelper: 'Nutze lieber einen Spitznamen als deinen vollen echten Namen.',
      avatarHeading: 'Avatar',
      avatarDescription: 'Suche dir einen Obstfreund fuer dein Profil aus.',
      chooseAvatar: 'Avatar waehlen',
      changeAvatar: 'Avatar aendern',
      removeAvatar: 'Avatar entfernen',
      noAvatarSelected: 'Noch kein Avatar ausgewaehlt.',
      badgesHeading: 'Badges',
      badgesDescription: 'Waehle bis zu 3 Badges, die zu dir passen.',
      badgesSelected: (count, limit) => `${count}/${limit} Badges ausgewaehlt`,
      saveProfile: 'Profil speichern',
      avatarModalTitle: 'Waehle deinen Avatar',
      avatarModalDescription: 'Suche dir eine Frucht aus, fuege Accessoires hinzu und nimm deinen Favoriten.',
      avatarSubjectLabel: 'Fruchtfreund',
      avatarAccessoryLabel: 'Accessoires',
      clearFilters: 'Filter loeschen',
      avatarResults: (count) => `${count} Avatar${count !== 1 ? 'e' : ''}`,
      avatarNoResults: 'Zu diesen Filtern gibt es noch keine Avatare. Versuche weniger Accessoires.',
      avatarNoAccessories: 'Keine Accessoires',
      useThisAvatar: 'Diesen Avatar nehmen',
      showMoreAvatars: 'Mehr zeigen',
      languageHeading: 'Sprache',
      languageDescription: 'Lege fest, in welcher Sprache App und Inhaltskatalog angezeigt werden.',
      themeHeading: 'Design',
      themeDescription: 'Wähle das visuelle Design der App.',
      calm: 'Ruhig',
      playful: 'Verspielt',
      lego: 'Baustein',
      minecraft: 'Blockwelt',
      active: 'Aktiv',
      currentTheme: 'Aktuelles Design',
      calmDescription: 'Gedämpfte Blau- und Grüntöne, minimale Animationen.',
      playfulDescription: 'Warme Orange- und Lilatöne, runde Ecken.',
      legoDescription: 'Kräftige Steinfarben, spielzeughafte Kontraste und ein Noppen-Hintergrund.',
      minecraftDescription: 'Erdige Blockfarben, eckige Flächen und ein verpixelter Hintergrund.',
      resetHeading: 'Alle Daten zurücksetzen',
      resetDescription:
        'Lösche deinen Fortschritt, Notizen, Lernsitzungen und Einstellungen. Das kann nicht rückgängig gemacht werden.',
      resetButton: 'Alle Daten zurücksetzen',
      resetModalTitle: 'Alle Daten zurücksetzen?',
      resetModalBody:
        'Dadurch werden alle Quiz-Antworten, Notizen, Lernsitzungen und Einstellungen dauerhaft gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.',
      cancel: 'Abbrechen',
      confirmReset: 'Ja, alles zurücksetzen',
    },
    leaderboard: {
      pageTitle: 'Rangliste',
      heading: 'Rangliste',
      description: 'Dein Lernfortschritt. Lerne weiter, um aufzusteigen.',
      profileHeading: 'Dein Profil',
      noTopics: 'Wähle Themen aus, damit deine Quizpunkte verfolgt werden.',
      browseTopics: 'Themen ansehen',
      noPoints: 'Beantworte Quizfragen, um Punkte zu sammeln und in der Rangliste zu erscheinen.',
      youLabel: 'Du (1/1)',
      totalPoints: 'Gesamtpunkte',
      rank: 'Rang',
      streak: 'Lernserie',
      streakDay: 'Tag',
      streakDays: 'Tage',
      onARoll: 'Läuft bei dir!',
      topicsSelected: 'Ausgewählte Themen',
      loading: 'Wird geladen...',
      youBadge: 'Du',
      pointsUnit: 'Pkt',
    },
    studyTimes: {
      pageTitle: 'Lernzeiten',
      heading: 'Lernzeiten',
      description: 'Verfolge deine Lernsitzungen und sieh deinen Fortschritt im Zeitverlauf.',
      recentSessions: 'Letzte Sitzungen',
      loading: 'Wird geladen...',
      today: 'Heute',
      thisWeek: 'Diese Woche',
      totalSessions: 'Sitzungen gesamt',
      studyTime: 'Lernzeit',
      completed: 'abgeschlossen',
      noSessions: 'Noch keine Lernsitzungen.',
      noSessionsBody: 'Starte auf einer Themenseite eine Sitzung, um deine Lernzeit zu erfassen.',
      general: 'Allgemein',
    },
    quiz: {
      emptyHeading: 'Für dieses Thema gibt es noch keine Quizfragen.',
      emptyBody: 'Nutze stattdessen die Tabs Notizen oder Lernplan.',
      completeHeading: 'Quiz abgeschlossen!',
      answeredSummary: (count) => `${count} Frage${count !== 1 ? 'n' : ''} beantwortet`,
      retry: 'Quiz wiederholen',
      questionProgress: (current, total) => `Frage ${current} von ${total}`,
      scoreProgress: (answered, total, points) => `${answered}/${total} beantwortet · ${points} Pkt`,
      singleChoice: 'Single Choice',
      multiChoice: 'Multiple Choice',
      flashcard: 'Karteikarte',
      previous: 'Zurück',
      next: 'Weiter',
      correct: 'Richtig!',
      incorrect: 'Falsch',
      selectAll: 'Wähle alle passenden Antworten aus',
      submitAnswer: 'Antwort prüfen',
      scoreLabel: (score) => `Punkte: ${score}`,
      flashcardQuestion: 'Frage',
      flashcardAnswer: 'Antwort',
      revealAnswer: 'Antwort anzeigen',
      didntKnow: 'Wusste ich nicht',
      knewIt: 'Wusste ich',
      knewItFeedback: 'Du wusstest es! +1 Punkt',
      didntKnowFeedback: 'Du wusstest es nicht. Weiterlernen lohnt sich.',
    },
    notes: {
      saving: 'Speichert...',
      saved: 'Gespeichert',
      unsaved: 'Ungespeichert',
      autoSave: 'Notizen werden automatisch in deinem Browser gespeichert.',
    },
    studyPlan: {
      done: 'Fertig',
      completeTask: (title) => `Abschließen: ${title}`,
      emptyHeading: 'Für dieses Thema gibt es noch keinen Lernplan.',
      emptyBody: 'Nutze stattdessen die Tabs Quiz oder Notizen.',
      overallProgress: 'Gesamtfortschritt',
      tasksCompleted: (completed, total) => `${completed}/${total} Aufgaben erledigt`,
    },
    studyTimer: {
      activeSessionTitle: 'Aktive Lernsitzung erkannt',
      activeSessionBody:
        'Du hast die Seite wahrscheinlich während einer Sitzung neu geladen. Möchtest du fortfahren oder sie beenden?',
      continue: 'Fortfahren',
      stop: 'Beenden',
      startSession: 'Sitzung starten',
      stopSession: 'Sitzung beenden',
    },
    storage: {
      title: 'Speicher nicht verfügbar',
      description:
        'Der lokale Speicher deines Browsers ist nicht verfügbar (Privatmodus?). Die App funktioniert trotzdem, aber Fortschritt und Einstellungen werden nicht zwischen Sitzungen gespeichert.',
      dismiss: 'Warnung ausblenden',
    },
  },
};

export function getCopy(language: LanguageCode): Copy {
  return copy[language];
}
