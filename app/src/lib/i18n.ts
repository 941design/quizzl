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
      groups: string;
      settings: string;
    };
    languageLabel: string;
    mobileMenuLabel: string;
    profileFallbackName: string;
    notificationsLabel: string;
    noNotifications: string;
    unreadMessages: (count: number) => string;
    joinRequestNotification: (count: number) => string;
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
    selectedAvatarAlt: string;
    avatarOptionAlt: string;
    languageHeading: string;
    languageDescription: string;
    themeHeading: string;
    themeDescription: string;
    calm: string;
    playful: string;
    lego: string;
    minecraft: string;
    flower: string;
    active: string;
    currentTheme: string;
    calmDescription: string;
    playfulDescription: string;
    legoDescription: string;
    minecraftDescription: string;
    flowerDescription: string;
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
  identity: {
    sectionHeading: string;
    sectionDescription: string;
    npubLabel: string;
    copyNpub: string;
    copiedNpub: string;
    showQr: string;
    qrModalTitle: string;
    qrGenerationError: string;
    backupHeading: string;
    backupDescription: string;
    generatePhrase: string;
    backupWarning: string;
    backupConfirmCheck: string;
    backupDone: string;
    restoreHeading: string;
    restoreDescription: string;
    restoreInput: string;
    restoreButton: string;
    restoreSuccess: string;
    restoreError: string;
    backupReminderTitle: string;
    backupReminderBody: string;
    backupReminderAction: string;
    backupReminderDismiss: string;
    notReady: string;
  };
  groups: {
    pageTitle: string;
    heading: string;
    description: string;
    noGroups: string;
    noGroupsBody: string;
    createGroup: string;
    createGroupTitle: string;
    createGroupNameLabel: string;
    createGroupNamePlaceholder: string;
    createGroupSubmit: string;
    cancel: string;
    memberCount: (count: number) => string;
    inviteMember: string;
    inviteTitle: string;
    inviteNpubLabel: string;
    inviteNpubPlaceholder: string;
    inviteHelp: string;
    inviteSubmit: string;
    inviteSuccess: string;
    inviteWarningAdminPromotion: string;
    inviteErrorNoKeyPackage: string;
    inviteErrorInvalidNpub: string;
    inviteErrorOffline: string;
    inviteErrorTimeout: string;
    inviteErrorGeneric: string;
    leaveGroup: string;
    leaveGroupTitle: string;
    leaveGroupBody: string;
    leaveGroupConfirm: string;
    loading: string;
    offlineBanner: string;
    offlineLastSync: (time: string) => string;
    syncNow: string;
    memberScoresHeading: string;
    noScoresYet: string;
    fromGroup: (name: string) => string;
    softLimitWarning: string;
    navLabel: string;
    showQr: string;
    scanQr: string;
    qrModalTitle: string;
    qrScannerTitle: string;
    qrScannerHint: string;
    qrInvalidPayload: string;
    cameraPermissionDenied: string;
    qrUnavailable: string;
    qrGenerationError: string;
    httpsRequired: string;
    httpsRequiredBody: string;
    inviteLinkButton: string;
    inviteLinkTitle: string;
    inviteLinkCopy: string;
    inviteLinkCopied: string;
    inviteLinkCopyError: string;
    inviteLinkLabelField: string;
    inviteLinkLabelPlaceholder: string;
    joinRequestHeading: string;
    joinRequestDescription: string;
    joinRequestButton: string;
    joinRequestSent: string;
    joinRequestError: string;
    joinRequestAlreadyMember: string;
    joinRequestGoToGroup: string;
    pendingRequestsHeading: string;
    pendingRequestsApprove: string;
    pendingRequestsDeny: string;
    pendingRequestsApproveError: string;
    pendingRequestsEmpty: string;
    manageLinksButton: string;
    manageLinksTitle: string;
    manageLinksMuteLabel: string;
    manageLinksUntitled: string;
    membersHeading: string;
    chatHeading: string;
    groupNotFound: string;
    backToGroups: string;
    openGroup: string;
    noMembersYet: string;
    memberPending: string;
    memberYou: string;
    chatLoading: string;
    chatEmpty: string;
    chatPlaceholder: string;
    chatNewMessages: string;
    chatJustNow: string;
    chatMinutesAgo: (minutes: number) => string;
    createGroupError: string;
  };
  polls: {
    heading: (count: number) => string;
    noPolls: string;
    showClosed: (count: number) => string;
    hideClosed: (count: number) => string;
    showPolls: string;
    hidePolls: string;
    createPoll: string;
    pollButton: string;
    singleChoice: string;
    multipleChoice: string;
    vote: string;
    updateVote: string;
    voted: string;
    voteCount: (count: number) => string;
    voterCount: (count: number) => string;
    closePoll: string;
    closeConfirm: string;
    confirm: string;
    cancel: string;
    closed: string;
    pollLabel: string;
    pollResultsLabel: string;
    startedPoll: (name: string) => string;
    closedPoll: (name: string) => string;
    questionLabel: string;
    questionPlaceholder: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    optionsLabel: string;
    optionPlaceholder: (letter: string) => string;
    addOption: string;
    pollTypeLabel: string;
    createError: string;
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
        groups: 'Groups',
        settings: 'Settings',
      },
      languageLabel: 'Language',
      mobileMenuLabel: 'Toggle navigation menu',
      profileFallbackName: 'Player One',
      notificationsLabel: 'Notifications',
      noNotifications: 'No new messages',
      unreadMessages: (count: number) => count === 1 ? '1 new message' : `${count} new messages`,
      joinRequestNotification: (count: number) => count === 1 ? '1 join request' : `${count} join requests`,
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
      avatarDescription: 'Pick an avatar for your profile.',
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
      selectedAvatarAlt: 'Selected avatar',
      avatarOptionAlt: 'Avatar option',
      languageHeading: 'Language',
      languageDescription: 'Choose which language the app and content catalogue should use.',
      themeHeading: 'Theme',
      themeDescription: 'Choose the visual theme for the app.',
      calm: 'Calm',
      playful: 'Playful',
      lego: 'Brick Builder',
      minecraft: 'Block World',
      flower: 'Flower Garden',
      active: 'Active',
      currentTheme: 'Current theme',
      calmDescription: 'Muted blues and greens, minimal animations.',
      playfulDescription: 'Warm oranges and purples, rounded corners.',
      legoDescription: 'Bold brick colors, toy-like contrast, and a stud-patterned background.',
      minecraftDescription: 'Earthy block tones, squared surfaces, and a pixelated backdrop.',
      flowerDescription: 'Soft blossom tones, petal-like shapes, and a bright floral backdrop.',
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
    identity: {
      sectionHeading: 'Nostr Identity',
      sectionDescription:
        'Your Quizzl identity is used for learning groups. It is stored in your browser.',
      npubLabel: 'Your public key (npub)',
      copyNpub: 'Copy npub',
      copiedNpub: 'Copied!',
      showQr: 'Show QR',
      qrModalTitle: 'Npub QR Code',
      qrGenerationError: 'Failed to generate QR code.',
      backupHeading: 'Back Up Your Identity',
      backupDescription:
        'Generate a recovery phrase to restore your identity if you clear browser data.',
      generatePhrase: 'Generate Backup Phrase',
      backupWarning:
        'Write down these 24 words in order and keep them safe. They cannot be recovered if lost.',
      backupConfirmCheck: 'I have written down my recovery phrase',
      backupDone: 'Identity backed up successfully.',
      restoreHeading: 'Restore from Backup',
      restoreDescription: 'Enter your 24-word recovery phrase to restore your identity.',
      restoreInput: 'Enter recovery phrase...',
      restoreButton: 'Restore Identity',
      restoreSuccess: 'Identity restored successfully.',
      restoreError: 'Invalid recovery phrase. Please check the words and try again.',
      backupReminderTitle: 'Back up your identity',
      backupReminderBody:
        "You are in a group but haven't backed up your identity. If you clear browser data, you will lose access.",
      backupReminderAction: 'Back up now',
      backupReminderDismiss: 'Dismiss',
      notReady: 'Identity not ready yet',
    },
    groups: {
      pageTitle: 'Groups',
      heading: 'Learning Groups',
      description: 'Study together with friends. Share your progress and learn as a team.',
      noGroups: 'You are not in any groups yet.',
      noGroupsBody: 'Create a group or wait for an invitation from a friend.',
      createGroup: 'Create Group',
      createGroupTitle: 'Create Learning Group',
      createGroupNameLabel: 'Group Name',
      createGroupNamePlaceholder: 'e.g. Biology Study Group',
      createGroupSubmit: 'Create Group',
      cancel: 'Cancel',
      memberCount: (count) => `${count} member${count !== 1 ? 's' : ''}`,
      inviteMember: 'Invite Member',
      inviteTitle: 'Invite by Npub',
      inviteNpubLabel: "Member's npub",
      inviteNpubPlaceholder: 'npub1...',
      inviteHelp: 'Enter or scan the npub of the person you want to invite. They must have used Quizzl at least once to appear.',
      inviteSubmit: 'Send Invite',
      inviteSuccess: 'Invitation sent successfully.',
      inviteWarningAdminPromotion: 'Invited, but admin promotion failed. The new member may not be able to invite others.',
      inviteErrorNoKeyPackage: 'This user has not set up their Quizzl identity yet.',
      inviteErrorInvalidNpub: 'Invalid npub format.',
      inviteErrorOffline: 'You are offline. Please connect to invite members.',
      inviteErrorTimeout: 'Relay timed out. Please try again.',
      inviteErrorGeneric: 'Failed to send invitation. Please try again.',
      leaveGroup: 'Leave Group',
      leaveGroupTitle: 'Leave Group?',
      leaveGroupBody: 'You will lose access to this group and its shared progress.',
      leaveGroupConfirm: 'Leave Group',
      loading: 'Loading...',
      offlineBanner: 'Offline — group sync unavailable',
      offlineLastSync: (time) => `Last synced: ${time}`,
      syncNow: 'Sync now',
      memberScoresHeading: 'Group Progress',
      noScoresYet: 'No quiz scores shared yet.',
      fromGroup: (name) => `From group: ${name}`,
      softLimitWarning: 'This group is near the recommended limit of 50 members.',
      navLabel: 'Groups',
      showQr: 'Show QR code',
      scanQr: 'Scan QR code',
      qrModalTitle: 'Npub QR Code',
      qrScannerTitle: 'Scan Npub QR Code',
      qrScannerHint: 'Point the camera at a QR code containing an npub.',
      qrInvalidPayload: 'This QR code does not contain a valid npub.',
      cameraPermissionDenied: 'Camera permission was denied.',
      qrUnavailable: 'QR scanning is unavailable on this device or browser.',
      qrGenerationError: 'Failed to generate QR code.',
      httpsRequired: 'HTTPS required',
      httpsRequiredBody: 'Encrypted groups require a secure connection (HTTPS). Please access this site over HTTPS to use groups.',
      inviteLinkButton: 'Invite Link',
      inviteLinkTitle: 'Generate Invite Link',
      inviteLinkCopy: 'Copy Link',
      inviteLinkCopied: 'Link copied to clipboard',
      inviteLinkCopyError: 'Failed to copy link',
      inviteLinkLabelField: 'Label (optional)',
      inviteLinkLabelPlaceholder: 'e.g. Sent to class chat',
      joinRequestHeading: "You've been invited to join a group",
      joinRequestDescription: 'Send a join request to the group admin?',
      joinRequestButton: 'Request to Join',
      joinRequestSent: "Request sent! You'll be added once the admin approves.",
      joinRequestError: 'Failed to send join request. Please try again.',
      joinRequestAlreadyMember: "You're already a member of this group.",
      joinRequestGoToGroup: 'Go to group',
      pendingRequestsHeading: 'Pending Join Requests',
      pendingRequestsApprove: 'Approve',
      pendingRequestsDeny: 'Deny',
      pendingRequestsApproveError: 'Failed to approve request. Please try again.',
      pendingRequestsEmpty: 'No pending requests.',
      manageLinksButton: 'Manage Links',
      manageLinksTitle: 'Manage Invite Links',
      manageLinksMuteLabel: 'Muted',
      manageLinksUntitled: 'Untitled',
      membersHeading: 'Members',
      chatHeading: 'Chat',
      groupNotFound: 'Group not found.',
      backToGroups: 'Back to Groups',
      openGroup: 'Open',
      noMembersYet: 'No members yet.',
      memberPending: 'Pending',
      memberYou: 'You',
      chatLoading: 'Loading messages...',
      chatEmpty: 'No messages yet. Say hello!',
      chatPlaceholder: 'Type a message...',
      chatNewMessages: 'New messages',
      chatJustNow: 'just now',
      chatMinutesAgo: (minutes: number) => `${minutes}m ago`,
      createGroupError: 'Failed to create group. Please try again.',
    },
    polls: {
      heading: (count: number) => count > 0 ? `Polls (${count})` : 'Polls',
      noPolls: 'No polls yet',
      showClosed: (count: number) => `Show closed polls (${count})`,
      hideClosed: (count: number) => `Hide closed polls (${count})`,
      showPolls: 'Show Polls',
      hidePolls: 'Hide Polls',
      createPoll: 'Create Poll',
      pollButton: 'Poll',
      singleChoice: 'Single choice',
      multipleChoice: 'Multiple choice',
      vote: 'Vote',
      updateVote: 'Update Vote',
      voted: 'Voted',
      voteCount: (count: number) => count === 1 ? '1 vote' : `${count} votes`,
      voterCount: (count: number) => count === 1 ? '1 voter' : `${count} voters`,
      closePoll: 'Close Poll',
      closeConfirm: 'Close this poll? Results will be shared in the chat.',
      confirm: 'Confirm',
      cancel: 'Cancel',
      closed: 'Closed',
      pollLabel: 'Poll',
      pollResultsLabel: 'Poll Results',
      startedPoll: (name: string) => `${name} started a poll`,
      closedPoll: (name: string) => `${name} closed the poll`,
      questionLabel: 'Question',
      questionPlaceholder: 'What would you like to ask?',
      descriptionLabel: 'Description (optional)',
      descriptionPlaceholder: 'Add more context...',
      optionsLabel: 'Options',
      optionPlaceholder: (letter: string) => `Option ${letter}`,
      addOption: '+ Add option',
      pollTypeLabel: 'Poll type',
      createError: 'Failed to create poll. Please try again.',
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
        groups: 'Gruppen',
        settings: 'Einstellungen',
      },
      languageLabel: 'Sprache',
      mobileMenuLabel: 'Navigationsmenü umschalten',
      profileFallbackName: 'Spieler Eins',
      notificationsLabel: 'Benachrichtigungen',
      noNotifications: 'Keine neuen Nachrichten',
      unreadMessages: (count: number) => count === 1 ? '1 neue Nachricht' : `${count} neue Nachrichten`,
      joinRequestNotification: (count: number) => count === 1 ? '1 Beitrittsanfrage' : `${count} Beitrittsanfragen`,
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
      avatarDescription: 'Waehle einen Avatar fuer dein Profil.',
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
      selectedAvatarAlt: 'Ausgewaehlter Avatar',
      avatarOptionAlt: 'Avataroption',
      languageHeading: 'Sprache',
      languageDescription: 'Lege fest, in welcher Sprache App und Inhaltskatalog angezeigt werden.',
      themeHeading: 'Design',
      themeDescription: 'Wähle das visuelle Design der App.',
      calm: 'Ruhig',
      playful: 'Verspielt',
      lego: 'Baustein',
      minecraft: 'Blockwelt',
      flower: 'Bluetengarten',
      active: 'Aktiv',
      currentTheme: 'Aktuelles Design',
      calmDescription: 'Gedämpfte Blau- und Grüntöne, minimale Animationen.',
      playfulDescription: 'Warme Orange- und Lilatöne, runde Ecken.',
      legoDescription: 'Kräftige Steinfarben, spielzeughafte Kontraste und ein Noppen-Hintergrund.',
      minecraftDescription: 'Erdige Blockfarben, eckige Flächen und ein verpixelter Hintergrund.',
      flowerDescription: 'Sanfte Blütentöne, blütenartige Formen und ein heller floraler Hintergrund.',
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
    identity: {
      sectionHeading: 'Nostr-Identität',
      sectionDescription:
        'Deine Quizzl-Identität wird für Lerngruppen verwendet und ist in deinem Browser gespeichert.',
      npubLabel: 'Dein öffentlicher Schlüssel (npub)',
      copyNpub: 'npub kopieren',
      copiedNpub: 'Kopiert!',
      showQr: 'QR zeigen',
      qrModalTitle: 'Npub-QR-Code',
      qrGenerationError: 'QR-Code konnte nicht erstellt werden.',
      backupHeading: 'Identität sichern',
      backupDescription:
        'Erstelle eine Wiederherstellungsphrase, um deine Identität bei gelöschten Browser-Daten zurückzugewinnen.',
      generatePhrase: 'Wiederherstellungsphrase erstellen',
      backupWarning:
        'Schreibe diese 24 Wörter in der richtigen Reihenfolge auf und bewahre sie sicher auf.',
      backupConfirmCheck: 'Ich habe meine Wiederherstellungsphrase aufgeschrieben',
      backupDone: 'Identität erfolgreich gesichert.',
      restoreHeading: 'Aus Backup wiederherstellen',
      restoreDescription: 'Gib deine 24-Wort-Phrase ein, um deine Identität wiederherzustellen.',
      restoreInput: 'Wiederherstellungsphrase eingeben...',
      restoreButton: 'Identität wiederherstellen',
      restoreSuccess: 'Identität erfolgreich wiederhergestellt.',
      restoreError: 'Ungültige Phrase. Bitte Wörter prüfen und erneut versuchen.',
      backupReminderTitle: 'Identität sichern',
      backupReminderBody:
        'Du bist in einer Gruppe, hast deine Identität aber noch nicht gesichert.',
      backupReminderAction: 'Jetzt sichern',
      backupReminderDismiss: 'Schließen',
      notReady: 'Identität wird vorbereitet',
    },
    groups: {
      pageTitle: 'Gruppen',
      heading: 'Lerngruppen',
      description: 'Lerne gemeinsam mit Freunden. Teile deinen Fortschritt und lerne als Team.',
      noGroups: 'Du bist noch in keiner Gruppe.',
      noGroupsBody: 'Erstelle eine Gruppe oder warte auf eine Einladung von einem Freund.',
      createGroup: 'Gruppe erstellen',
      createGroupTitle: 'Lerngruppe erstellen',
      createGroupNameLabel: 'Gruppenname',
      createGroupNamePlaceholder: 'z. B. Biologie-Lerngruppe',
      createGroupSubmit: 'Gruppe erstellen',
      cancel: 'Abbrechen',
      memberCount: (count) => `${count} Mitglied${count !== 1 ? 'er' : ''}`,
      inviteMember: 'Mitglied einladen',
      inviteTitle: 'Per Npub einladen',
      inviteNpubLabel: 'Npub des Mitglieds',
      inviteNpubPlaceholder: 'npub1...',
      inviteHelp: 'Gib die npub der Person ein oder scanne sie. Die Person muss Quizzl bereits einmal verwendet haben.',
      inviteSubmit: 'Einladung senden',
      inviteSuccess: 'Einladung erfolgreich gesendet.',
      inviteWarningAdminPromotion: 'Eingeladen, aber Admin-Beförderung fehlgeschlagen. Das neue Mitglied kann möglicherweise keine anderen einladen.',
      inviteErrorNoKeyPackage: 'Dieser Nutzer hat seine Quizzl-Identität noch nicht eingerichtet.',
      inviteErrorInvalidNpub: 'Ungültiges npub-Format.',
      inviteErrorOffline: 'Du bist offline. Bitte verbinde dich, um Mitglieder einzuladen.',
      inviteErrorTimeout: 'Relay-Zeitüberschreitung. Bitte erneut versuchen.',
      inviteErrorGeneric: 'Einladung fehlgeschlagen. Bitte erneut versuchen.',
      leaveGroup: 'Gruppe verlassen',
      leaveGroupTitle: 'Gruppe verlassen?',
      leaveGroupBody: 'Du verlierst den Zugriff auf diese Gruppe und den gemeinsamen Fortschritt.',
      leaveGroupConfirm: 'Gruppe verlassen',
      loading: 'Wird geladen...',
      offlineBanner: 'Offline — Gruppensynchronisation nicht verfügbar',
      offlineLastSync: (time) => `Zuletzt synchronisiert: ${time}`,
      syncNow: 'Jetzt synchronisieren',
      memberScoresHeading: 'Gruppenfortschritt',
      noScoresYet: 'Noch keine Quizpunkte geteilt.',
      fromGroup: (name) => `Aus Gruppe: ${name}`,
      softLimitWarning: 'Diese Gruppe nähert sich dem empfohlenen Limit von 50 Mitgliedern.',
      navLabel: 'Gruppen',
      showQr: 'QR-Code zeigen',
      scanQr: 'QR-Code scannen',
      qrModalTitle: 'Npub-QR-Code',
      qrScannerTitle: 'Npub-QR-Code scannen',
      qrScannerHint: 'Richte die Kamera auf einen QR-Code mit einer npub.',
      qrInvalidPayload: 'Dieser QR-Code enthält keine gültige npub.',
      cameraPermissionDenied: 'Kamerazugriff wurde verweigert.',
      qrUnavailable: 'QR-Scan ist auf diesem Gerät oder Browser nicht verfügbar.',
      qrGenerationError: 'QR-Code konnte nicht erstellt werden.',
      httpsRequired: 'HTTPS erforderlich',
      httpsRequiredBody: 'Verschlüsselte Gruppen erfordern eine sichere Verbindung (HTTPS). Bitte greife über HTTPS auf diese Seite zu, um Gruppen zu nutzen.',
      inviteLinkButton: 'Einladungslink',
      inviteLinkTitle: 'Einladungslink erstellen',
      inviteLinkCopy: 'Link kopieren',
      inviteLinkCopied: 'Link in Zwischenablage kopiert',
      inviteLinkCopyError: 'Link konnte nicht kopiert werden',
      inviteLinkLabelField: 'Bezeichnung (optional)',
      inviteLinkLabelPlaceholder: 'z. B. An Klassen-Chat gesendet',
      joinRequestHeading: 'Du wurdest zu einer Gruppe eingeladen',
      joinRequestDescription: 'Beitrittsanfrage an den Gruppenadmin senden?',
      joinRequestButton: 'Beitritt anfragen',
      joinRequestSent: 'Anfrage gesendet! Du wirst hinzugefügt, sobald der Admin zustimmt.',
      joinRequestError: 'Beitrittsanfrage fehlgeschlagen. Bitte erneut versuchen.',
      joinRequestAlreadyMember: 'Du bist bereits Mitglied dieser Gruppe.',
      joinRequestGoToGroup: 'Zur Gruppe',
      pendingRequestsHeading: 'Offene Beitrittsanfragen',
      pendingRequestsApprove: 'Genehmigen',
      pendingRequestsDeny: 'Ablehnen',
      pendingRequestsApproveError: 'Anfrage konnte nicht genehmigt werden. Bitte erneut versuchen.',
      pendingRequestsEmpty: 'Keine offenen Anfragen.',
      manageLinksButton: 'Links verwalten',
      manageLinksTitle: 'Einladungslinks verwalten',
      manageLinksMuteLabel: 'Stummgeschaltet',
      manageLinksUntitled: 'Ohne Titel',
      membersHeading: 'Mitglieder',
      chatHeading: 'Chat',
      groupNotFound: 'Gruppe nicht gefunden.',
      backToGroups: 'Zurück zu Gruppen',
      openGroup: 'Öffnen',
      noMembersYet: 'Noch keine Mitglieder.',
      memberPending: 'Ausstehend',
      memberYou: 'Du',
      chatLoading: 'Nachrichten werden geladen...',
      chatEmpty: 'Noch keine Nachrichten. Sag Hallo!',
      chatPlaceholder: 'Nachricht eingeben...',
      chatNewMessages: 'Neue Nachrichten',
      chatJustNow: 'gerade eben',
      chatMinutesAgo: (minutes: number) => `vor ${minutes} Min.`,
      createGroupError: 'Gruppe konnte nicht erstellt werden. Bitte erneut versuchen.',
    },
    polls: {
      heading: (count: number) => count > 0 ? `Umfragen (${count})` : 'Umfragen',
      noPolls: 'Noch keine Umfragen',
      showClosed: (count: number) => `Geschlossene Umfragen anzeigen (${count})`,
      hideClosed: (count: number) => `Geschlossene Umfragen ausblenden (${count})`,
      showPolls: 'Umfragen anzeigen',
      hidePolls: 'Umfragen ausblenden',
      createPoll: 'Umfrage erstellen',
      pollButton: 'Umfrage',
      singleChoice: 'Einzelauswahl',
      multipleChoice: 'Mehrfachauswahl',
      vote: 'Abstimmen',
      updateVote: 'Stimme ändern',
      voted: 'Abgestimmt',
      voteCount: (count: number) => count === 1 ? '1 Stimme' : `${count} Stimmen`,
      voterCount: (count: number) => count === 1 ? '1 Teilnehmer' : `${count} Teilnehmer`,
      closePoll: 'Umfrage schließen',
      closeConfirm: 'Umfrage schließen? Ergebnisse werden im Chat geteilt.',
      confirm: 'Bestätigen',
      cancel: 'Abbrechen',
      closed: 'Geschlossen',
      pollLabel: 'Umfrage',
      pollResultsLabel: 'Umfrageergebnisse',
      startedPoll: (name: string) => `${name} hat eine Umfrage gestartet`,
      closedPoll: (name: string) => `${name} hat die Umfrage geschlossen`,
      questionLabel: 'Frage',
      questionPlaceholder: 'Was möchtest du fragen?',
      descriptionLabel: 'Beschreibung (optional)',
      descriptionPlaceholder: 'Mehr Kontext hinzufügen...',
      optionsLabel: 'Optionen',
      optionPlaceholder: (letter: string) => `Option ${letter}`,
      addOption: '+ Option hinzufügen',
      pollTypeLabel: 'Umfragetyp',
      createError: 'Umfrage konnte nicht erstellt werden. Bitte erneut versuchen.',
    },
  },
};

export function getCopy(language: LanguageCode): Copy {
  return copy[language];
}
