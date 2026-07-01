import type { LanguageCode } from '@/src/types';

type Copy = {
  appName: string;
  languageNames: Record<LanguageCode, string>;
  layout: {
    nav: {
      contacts: string;
      groups: string;
      settings: string;
    };
    languageLabel: string;
    mobileMenuLabel: string;
    profileNamePlaceholder: string;
    notificationsLabel: string;
    noNotifications: string;
    unreadMessages: (count: number) => string;
    joinRequestNotification: (count: number) => string;
    directMessageNotification: (count: number) => string;
    backupNeededLabel: string;
    imprintLink: string;
  };
  imprint: {
    pageTitle: string;
    heading: string;
    providerHeading: string;
    representedByLabel: string;
    contactHeading: string;
    emailLabel: string;
    phoneLabel: string;
    registerHeading: string;
    registerCourtLabel: string;
    registerNumberLabel: string;
    vatHeading: string;
    vatLabel: string;
  };
  home: {
    title: string;
    description: string;
    subheadingLead: string;
    subheadingPoints: string[];
    contactsTitle: string;
    contactsSubtitle: string;
    groupsTitle: string;
    groupsSubtitle: string;
    profileTitle: string;
    profileSubtitle: string;
  };
  settings: {
    pageTitle: string;
    heading: string;
    description: string;
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
    cancel: string;
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
    noMembersYet: string;
    memberPending: string;
    memberYou: string;
    cancelInviteButton: string;
    cancelInviteTitle: string;
    cancelInviteBody: string;
    cancelInviteConfirm: string;
    cancelInviteSuccess: string;
    cancelInviteError: string;
    cancelInviteRaceNotice: string;
    cancelInviteAnnouncementWarning: string;
    cancelledByAnnouncement: (member: string, canceller: string) => string;
    leftGroup: (member: string) => string;
    makeAdminButton: string;
    makeAdminTitle: string;
    makeAdminBody: string;
    makeAdminConfirm: string;
    makeAdminSuccess: string;
    makeAdminError: string;
    adminBadge: string;
    lastAdminLeaveBlocked: string;
    leavePendingBadge: string;
    removalPendingBadge: string;
    chatLoading: string;
    chatEmpty: string;
    chatPlaceholder: string;
    chatNewMessages: string;
    chatJustNow: string;
    chatMinutesAgo: (minutes: number) => string;
    createGroupError: string;
    imageAttachmentLabel: string;
    imageProcessing: string;
    imageUploading: (pct: number) => string;
    imageSendFailed: string;
    imageRetry: string;
    imageDecryptFailed: string;
    imageUnavailable: string;
    imageDownload: string;
    imageTooLarge: string;
    imageRemove: string;
    pendingInvitations: {
      heading: string;
      acceptBtn: string;
      declineBtn: string;
      empty: string;
      acceptError: string;
      relativeJustNow: string;
      relativeMinutesAgo: (n: number) => string;
      relativeHoursAgo: (n: number) => string;
      relativeDaysAgo: (n: number) => string;
    };
  };
  contacts: {
    pageTitle: string;
    heading: string;
    description: string;
    emptyTitle: string;
    emptyBody: string;
    listHeading: string;
    hiddenFilterLabel: string;
    hideHiddenOption: string;
    showHiddenOption: (count: number) => string;
    hiddenOnlyBody: (count: number) => string;
    hiddenBadge: string;
    archiveAction: string;
    unarchiveAction: string;
    archivedDetailNotice: string;
    profileNameFallback: string;
    backToContacts: string;
    contactNotFound: string;
    commonGroups: (names: string[]) => string;
  };
  profile: {
    pageTitle: string;
    backLabel: string;
    copyNpub: string;
    copiedNpub: string;
    sendDm: string;
    archiveAction: string;
    unarchiveAction: string;
    viewProfile: string;
    notFound: string;
    addToGroupLabel: string;
    addToGroupSelect: string;
    addToGroupBtn: string;
    addToGroupSuccess: string;
    addToGroupError: string;
    ownHeading: string;
    ownDescription: string;
    backupNeededHint: string;
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
  emoji: {
    openPicker: string;
    closePicker: string;
    reactWith: string;
    insertEmoji: string;
    removeReaction: string;
    couldntReact: string;
    reactors: string;
    reactionCount: string;
  };
  updateBanner: {
    message: string;
    reload: string;
    dismissAriaLabel: string;
  };
  feedback: {
    settingsRowLabel: string;
    pageTitle: string;
    encryptedSubtitle: string;
    composerPlaceholder: string;
    unavailableState: string;
  };
  advanced: {
    sectionTitle: string;
    toggleExpand: string;
    toggleCollapse: string;
    relays: {
      sectionTitle: string;
      addPlaceholder: string;
      addBtn: string;
      removeBtn: string;
      resetBtn: string;
      saveBtn: string;
      savedSuccess: string;
      statusConnected: string;
      statusConnecting: string;
      statusDisconnected: string;
      lastRelayError: string;
      invalidUrlError: string;
      duplicateUrlError: string;
      discoverabilityNote: string;
    };
    dangerZone: {
      title: string;
      wipeBtn: string;
      wipeConfirmPrompt: string;
      wipeConfirmBtn: string;
      wipeConfirmWord: string;
      wipeCancel: string;
      wipeWarning: string;
    };
    nip46: {
      sectionTitle: string;
      description: string;
      disclosureGroupFast: string;
      disclosureIdentityLeaves: string;
      disclosureDmSlow: string;
      connectQrBtn: string;
      connectPasteBtn: string;
      relayInputLabel: string;
      relayInputPlaceholder: string;
      generateQrBtn: string;
      confirmConnectBtn: string;
      pasteUriLabel: string;
      pasteUriPlaceholder: string;
      connectBtn: string;
      connecting: string;
      connected: string;
      connectedAs: string;
      reconnecting: string;
      disconnect: string;
      signerUnavailable: string;
      retryBtn: string;
      errorUnreachable: string;
      authChallengeOpened: string;
    };
    nip07: {
      sectionTitle: string;
      description: string;
      connectBtn: string;
      connecting: string;
      connected: string;
      connectedAs: string;
      disconnect: string;
      noExtensionError: string;
      nip44MissingError: string;
      reconnectError: string;
    };
  };
  calls: {
    incomingCallTitle: string;
    incomingVoiceCall: string;
    incomingVideoCall: string;
    acceptCall: string;
    declineCall: string;
    muteAudio: string;
    unmuteAudio: string;
    cameraOff: string;
    cameraOn: string;
    hangUp: string;
    participants: (count: number) => string;
    callConnected: string;
    startVoiceCall: string;
    startVideoCall: string;
    callDisabledGroupFull: string;
    callInProgress: string;
    callSettings: string;
    turnServerUrl: string;
    turnUsername: string;
    turnCredential: string;
    saveTurnConfig: string;
    ipPrivacyMode: string;
    turnHelp: string;
    ipPrivacyHelp: string;
    callStartedNotice: (callerName: string) => string;
    callEndedNotice: string;
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
    appName: 'Nostling',
    languageNames: { en: 'English', de: 'Deutsch' },
    layout: {
      nav: {
        contacts: 'Contacts',
        groups: 'Groups',
        settings: 'Settings',
      },
      languageLabel: 'Language',
      mobileMenuLabel: 'Toggle navigation menu',
      profileNamePlaceholder: 'Set your name',
      notificationsLabel: 'Notifications',
      noNotifications: 'No new messages',
      unreadMessages: (count: number) => count === 1 ? '1 new message' : `${count} new messages`,
      joinRequestNotification: (count: number) => count === 1 ? '1 join request' : `${count} join requests`,
      directMessageNotification: (count: number) => count === 1 ? '1 new direct message' : `${count} new direct messages`,
      backupNeededLabel: 'Backup needed',
      imprintLink: 'Imprint',
    },
    imprint: {
      pageTitle: 'Imprint',
      heading: 'Imprint',
      providerHeading: 'Information pursuant to § 5 DDG',
      representedByLabel: 'Represented by',
      contactHeading: 'Contact',
      emailLabel: 'Email',
      phoneLabel: 'Phone',
      registerHeading: 'Commercial register',
      registerCourtLabel: 'Register court',
      registerNumberLabel: 'Register number',
      vatHeading: 'VAT ID',
      vatLabel: 'VAT identification number pursuant to § 27a of the German VAT Act',
    },
    home: {
      title: 'Welcome to Nostling',
      description:
        'Private, end-to-end encrypted chats. Message your contacts directly or talk together in groups.',
      subheadingLead: 'Just chat.',
      subheadingPoints: [
        'No email address required',
        'No login or password to remember',
        'No phone number needed',
        'Completely free',
      ],
      contactsTitle: 'Contacts',
      contactsSubtitle: 'Message the people you know directly.',
      groupsTitle: 'Groups',
      groupsSubtitle: 'Chat together in groups.',
      profileTitle: 'Profile',
      profileSubtitle: 'Manage your nickname and avatar.',
    },
    settings: {
      pageTitle: 'Settings',
      heading: 'Settings',
      description: 'Manage your Nostr identity and key backup.',
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
      languageDescription: 'Choose which language the app should use.',
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
      cancel: 'Cancel',
    },
    storage: {
      title: 'Storage Unavailable',
      description:
        "Your browser's local storage is not available (private mode?). The app will work, but your settings won't be saved between sessions.",
      dismiss: 'Dismiss warning',
    },
    identity: {
      sectionHeading: 'Nostr Identity',
      sectionDescription:
        'Your Nostling identity is used for groups and direct messages. It is stored in your browser.',
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
      heading: 'Groups',
      description: 'Chat with friends and stay in touch as a group.',
      noGroups: 'You are not in any groups yet.',
      noGroupsBody: 'Create a group or wait for an invitation from a friend.',
      createGroup: 'Create Group',
      createGroupTitle: 'Create Group',
      createGroupNameLabel: 'Group Name',
      createGroupNamePlaceholder: 'e.g. Weekend Hikers',
      createGroupSubmit: 'Create Group',
      cancel: 'Cancel',
      memberCount: (count) => `${count} member${count !== 1 ? 's' : ''}`,
      inviteMember: 'Invite Member',
      inviteTitle: 'Invite by Npub',
      inviteNpubLabel: "Member's npub",
      inviteNpubPlaceholder: 'npub1...',
      inviteHelp: 'Enter or scan the npub of the person you want to invite. They must have used Nostling at least once to appear.',
      inviteSubmit: 'Send Invite',
      inviteSuccess: 'Invitation sent successfully.',
      inviteErrorNoKeyPackage: 'This user has not set up their Nostling identity yet.',
      inviteErrorInvalidNpub: 'Invalid npub format.',
      inviteErrorOffline: 'You are offline. Please connect to invite members.',
      inviteErrorTimeout: 'Relay timed out. Please try again.',
      inviteErrorGeneric: 'Failed to send invitation. Please try again.',
      leaveGroup: 'Leave Group',
      leaveGroupTitle: 'Leave Group?',
      leaveGroupBody: 'You will lose access to this group and its messages.',
      leaveGroupConfirm: 'Leave Group',
      loading: 'Loading...',
      offlineBanner: 'Offline — group sync unavailable',
      offlineLastSync: (time) => `Last synced: ${time}`,
      syncNow: 'Sync now',
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
      noMembersYet: 'No members yet.',
      memberPending: 'Pending',
      memberYou: 'You',
      cancelInviteButton: 'Cancel Invite',
      cancelInviteTitle: 'Cancel Pending Invitation',
      cancelInviteBody: 'Cancel this pending invitation? They will be removed from the group permanently.',
      cancelInviteConfirm: 'Confirm',
      cancelInviteSuccess: 'Invitation cancelled',
      cancelInviteError: 'Failed to cancel invitation',
      cancelInviteRaceNotice: 'This invitation is no longer pending',
      cancelInviteAnnouncementWarning: 'Invitation cancelled, but the group chat could not be notified',
      cancelledByAnnouncement: (member: string, canceller: string) => `${member} was uninvited by ${canceller}`,
      leftGroup: (member: string) => `${member} left the group`,
      makeAdminButton: 'Make Admin',
      makeAdminTitle: 'Make Admin?',
      makeAdminBody: 'This cannot be undone. Admins can invite members, accept join requests, cancel invitations, and grant admin to others.',
      makeAdminConfirm: 'Make Admin',
      makeAdminSuccess: 'Admin granted',
      makeAdminError: 'Failed to grant admin. Please try again.',
      adminBadge: 'Admin',
      lastAdminLeaveBlocked: 'You are the only admin. Grant admin to another member before leaving.',
      leavePendingBadge: 'Departed, cleanup pending',
      // removalPendingBadge is reserved for a future cause-distinction increment (S6 decision:
      // PendingRemoval carries no cause field, so all pending removals use leavePendingBadge today).
      removalPendingBadge: 'Removal pending',
      chatLoading: 'Loading messages...',
      chatEmpty: 'No messages yet. Say hello!',
      chatPlaceholder: 'Type a message...',
      chatNewMessages: 'New messages',
      chatJustNow: 'just now',
      chatMinutesAgo: (minutes: number) => `${minutes}m ago`,
      createGroupError: 'Failed to create group. Please try again.',
      imageAttachmentLabel: 'Attach image',
      imageProcessing: 'Processing image…',
      imageUploading: (pct: number) => `Uploading ${pct}%`,
      imageSendFailed: 'Failed to send image',
      imageRetry: 'Retry',
      imageDecryptFailed: "Couldn't decrypt this image",
      imageUnavailable: 'Image is no longer available',
      imageDownload: 'Download',
      imageTooLarge: 'Image is too large',
      imageRemove: 'Remove image',
      pendingInvitations: {
        heading: 'Pending Invitations',
        acceptBtn: 'Accept',
        declineBtn: 'Decline',
        empty: 'No pending invitations',
        acceptError: 'This invitation is no longer valid',
        relativeJustNow: 'just now',
        relativeMinutesAgo: (n: number) => `${n}m ago`,
        relativeHoursAgo: (n: number) => `${n}h ago`,
        relativeDaysAgo: (n: number) => `${n}d ago`,
      },
    },
    contacts: {
      pageTitle: 'Contacts',
      heading: 'Contacts',
      description: 'People from your shared groups stay here so you can keep chatting directly.',
      emptyTitle: 'No contacts yet',
      emptyBody: 'Join a group with someone and they will appear here.',
      listHeading: 'All contacts',
      hiddenFilterLabel: 'Hidden contacts',
      hideHiddenOption: 'Hide hidden contacts',
      showHiddenOption: (count: number) => count === 0 ? 'Show hidden contacts' : `Show hidden contacts (${count})`,
      hiddenOnlyBody: (count: number) => count === 1 ? '1 hidden contact is currently filtered out.' : `${count} hidden contacts are currently filtered out.`,
      hiddenBadge: 'Hidden',
      archiveAction: 'Hide',
      unarchiveAction: 'Unarchive',
      archivedDetailNotice: 'This contact is hidden from the default list view until you unarchive them.',
      profileNameFallback: 'Unnamed contact',
      backToContacts: 'Back to Contacts',
      contactNotFound: 'Contact not found.',
      commonGroups: (names: string[]) => `Groups: ${names.join(', ')}`,
    },
    profile: {
      pageTitle: 'Profile',
      backLabel: 'Back',
      copyNpub: 'Copy',
      copiedNpub: 'Copied!',
      sendDm: 'Send message',
      archiveAction: 'Hide contact',
      unarchiveAction: 'Unarchive contact',
      viewProfile: 'View profile',
      notFound: 'Profile not found.',
      addToGroupLabel: 'Add to a group',
      addToGroupSelect: 'Choose a group',
      addToGroupBtn: 'Add to group',
      addToGroupSuccess: 'Contact added to the group.',
      addToGroupError: 'Could not add the contact to the group. Please try again.',
      ownHeading: 'My Profile',
      ownDescription: 'Customize how you appear in Nostling.',
      backupNeededHint: 'Your identity is not backed up yet. Go to Settings to back it up.',
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
    emoji: {
      openPicker: 'Open emoji picker',
      closePicker: 'Close emoji picker',
      reactWith: 'React with emoji',
      insertEmoji: 'Insert emoji',
      removeReaction: 'Remove reaction',
      couldntReact: "Couldn't react",
      reactors: 'Reactors',
      reactionCount: 'reactions',
    },
    updateBanner: {
      message: 'A new version is available.',
      reload: 'Reload',
      dismissAriaLabel: 'Dismiss update notification',
    },
    feedback: {
      settingsRowLabel: 'Send feedback to the maintainers',
      pageTitle: 'Feedback to the Nostling team',
      encryptedSubtitle: 'End-to-end encrypted · only the team can read this',
      composerPlaceholder: 'Describe a bug, suggest a feature, or say hello…',
      unavailableState: 'Feedback is currently unavailable.',
    },
    advanced: {
      sectionTitle: 'Advanced',
      toggleExpand: 'Show advanced settings',
      toggleCollapse: 'Hide advanced settings',
      relays: {
        sectionTitle: 'Relay servers',
        addPlaceholder: 'wss://relay.example.com',
        addBtn: 'Add',
        removeBtn: 'Remove',
        resetBtn: 'Reset to defaults',
        saveBtn: 'Save',
        savedSuccess: 'Relay list saved.',
        statusConnected: 'Connected',
        statusConnecting: 'Connecting',
        statusDisconnected: 'Disconnected',
        lastRelayError: 'At least one relay is required.',
        invalidUrlError: 'Enter a valid wss:// or ws:// URL.',
        duplicateUrlError: 'This relay is already in the list.',
        discoverabilityNote: 'Existing groups\' relay lists are not changed.',
      },
      dangerZone: {
        title: 'Danger Zone',
        wipeBtn: 'Wipe this device',
        wipeConfirmPrompt: 'Type WIPE to confirm',
        wipeConfirmBtn: 'Confirm wipe',
        wipeConfirmWord: 'WIPE',
        wipeCancel: 'Cancel',
        wipeWarning: 'This permanently clears your identity, all groups, and all message history from this device. This cannot be undone.',
      },
      nip46: {
        sectionTitle: 'Remote Signer',
        description: 'Connect a hardware signer, browser extension backend, or nsecBunker to keep your identity key off this device.',
        disclosureGroupFast: 'Group messages stay fast — group keys are always local.',
        disclosureIdentityLeaves: 'Your identity key will be held by the remote signer, not the browser.',
        disclosureDmSlow: 'Direct message history and large group invites will be slower due to remote signing.',
        connectQrBtn: 'Connect via QR / Deep link',
        connectPasteBtn: 'Paste a bunker:// URI',
        relayInputLabel: 'Rendezvous relay',
        relayInputPlaceholder: 'wss://relay.nsec.app',
        generateQrBtn: 'Generate QR',
        confirmConnectBtn: "I've approved — Connect",
        pasteUriLabel: 'Bunker URI',
        pasteUriPlaceholder: 'bunker://...',
        connectBtn: 'Connect',
        connecting: 'Connecting…',
        connected: 'Connected to remote signer',
        connectedAs: 'Connected as',
        reconnecting: 'Reconnecting to signer…',
        disconnect: 'Disconnect',
        signerUnavailable: 'Remote signer is unavailable. Publishing is paused.',
        retryBtn: 'Retry',
        errorUnreachable: 'Bunker unreachable. Check that your signer app is open and try again.',
        authChallengeOpened: 'An authorisation page was opened in a new tab.',
      },
      nip07: {
        sectionTitle: 'Browser Extension',
        description: 'Sign with a browser extension (Alby, nos2x-fox). No network latency — the extension signs locally.',
        connectBtn: 'Connect Extension',
        connecting: 'Connecting to extension…',
        connected: 'Connected to extension',
        connectedAs: 'Signed in as',
        disconnect: 'Disconnect',
        noExtensionError: 'No Nostr extension found. Install Alby or nos2x-fox.',
        nip44MissingError: 'This extension does not support NIP-44 encryption. Group features require NIP-44 (try Alby or nos2x-fox).',
        reconnectError: 'Extension is unavailable. Please reconnect.',
      },
    },
    calls: {
      incomingCallTitle: 'Incoming Call',
      incomingVoiceCall: 'Voice Call',
      incomingVideoCall: 'Video Call',
      acceptCall: 'Accept',
      declineCall: 'Decline',
      muteAudio: 'Mute',
      unmuteAudio: 'Unmute',
      cameraOff: 'Camera Off',
      cameraOn: 'Camera On',
      hangUp: 'Hang Up',
      participants: (count: number) => `${count} participant${count === 1 ? '' : 's'}`,
      callConnected: 'Call connected',
      startVoiceCall: 'Voice Call',
      startVideoCall: 'Video Call',
      callDisabledGroupFull: 'Group too large for calls (max 5)',
      callInProgress: 'Call in progress',
      callSettings: 'Call Settings',
      turnServerUrl: 'TURN Server URL',
      turnUsername: 'TURN Username',
      turnCredential: 'TURN Credential',
      saveTurnConfig: 'Save',
      ipPrivacyMode: 'IP Privacy Mode',
      turnHelp: 'Calls work out of the box using the public openrelayproject TURN relay — the same one Amethyst uses. Leave blank to keep it, or enter your own relay below.',
      ipPrivacyHelp: 'Route media through TURN to hide your IP from call participants (increases latency).',
      callStartedNotice: (callerName: string) => `${callerName} started a call`,
      callEndedNotice: 'Call ended',
    },
  },
  de: {
    appName: 'Nostling',
    languageNames: { en: 'English', de: 'Deutsch' },
    layout: {
      nav: {
        contacts: 'Kontakte',
        groups: 'Gruppen',
        settings: 'Einstellungen',
      },
      languageLabel: 'Sprache',
      mobileMenuLabel: 'Navigationsmenü umschalten',
      profileNamePlaceholder: 'Name festlegen',
      notificationsLabel: 'Benachrichtigungen',
      noNotifications: 'Keine neuen Nachrichten',
      unreadMessages: (count: number) => count === 1 ? '1 neue Nachricht' : `${count} neue Nachrichten`,
      joinRequestNotification: (count: number) => count === 1 ? '1 Beitrittsanfrage' : `${count} Beitrittsanfragen`,
      directMessageNotification: (count: number) => count === 1 ? '1 neue Direktnachricht' : `${count} neue Direktnachrichten`,
      backupNeededLabel: 'Sicherung erforderlich',
      imprintLink: 'Impressum',
    },
    imprint: {
      pageTitle: 'Impressum',
      heading: 'Impressum',
      providerHeading: 'Angaben gemäß § 5 DDG',
      representedByLabel: 'Vertreten durch',
      contactHeading: 'Kontakt',
      emailLabel: 'E-Mail',
      phoneLabel: 'Telefon',
      registerHeading: 'Registereintrag',
      registerCourtLabel: 'Registergericht',
      registerNumberLabel: 'Registernummer',
      vatHeading: 'Umsatzsteuer-ID',
      vatLabel: 'Umsatzsteuer-Identifikationsnummer gemäß § 27a Umsatzsteuergesetz',
    },
    home: {
      title: 'Willkommen bei Nostling',
      description:
        'Private, Ende-zu-Ende-verschlüsselte Chats. Schreibe deinen Kontakten direkt oder unterhalte dich gemeinsam in Gruppen.',
      subheadingLead: 'Einfach nur chatten.',
      subheadingPoints: [
        'Keine E-Mail-Adresse nötig',
        'Kein Login, kein Passwort zum Merken',
        'Keine Telefonnummer erforderlich',
        'Völlig kostenlos',
      ],
      contactsTitle: 'Kontakte',
      contactsSubtitle: 'Schreibe den Personen, die du kennst, direkt.',
      groupsTitle: 'Gruppen',
      groupsSubtitle: 'Chattet gemeinsam in Gruppen.',
      profileTitle: 'Profil',
      profileSubtitle: 'Verwalte deinen Spitznamen und Avatar.',
    },
    settings: {
      pageTitle: 'Einstellungen',
      heading: 'Einstellungen',
      description: 'Verwalte deine Nostr-Identität und Schlüsselsicherung.',
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
      languageDescription: 'Lege fest, in welcher Sprache die App angezeigt wird.',
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
      cancel: 'Abbrechen',
    },
    storage: {
      title: 'Speicher nicht verfügbar',
      description:
        'Der lokale Speicher deines Browsers ist nicht verfügbar (Privatmodus?). Die App funktioniert trotzdem, aber deine Einstellungen werden nicht zwischen Sitzungen gespeichert.',
      dismiss: 'Warnung ausblenden',
    },
    identity: {
      sectionHeading: 'Nostr-Identität',
      sectionDescription:
        'Deine Nostling-Identität wird für Gruppen und Direktnachrichten verwendet und ist in deinem Browser gespeichert.',
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
      heading: 'Gruppen',
      description: 'Chatte mit Freunden und bleibt als Gruppe in Kontakt.',
      noGroups: 'Du bist noch in keiner Gruppe.',
      noGroupsBody: 'Erstelle eine Gruppe oder warte auf eine Einladung von einem Freund.',
      createGroup: 'Gruppe erstellen',
      createGroupTitle: 'Gruppe erstellen',
      createGroupNameLabel: 'Gruppenname',
      createGroupNamePlaceholder: 'z. B. Wochenend-Wanderer',
      createGroupSubmit: 'Gruppe erstellen',
      cancel: 'Abbrechen',
      memberCount: (count) => `${count} Mitglied${count !== 1 ? 'er' : ''}`,
      inviteMember: 'Mitglied einladen',
      inviteTitle: 'Per Npub einladen',
      inviteNpubLabel: 'Npub des Mitglieds',
      inviteNpubPlaceholder: 'npub1...',
      inviteHelp: 'Gib die npub der Person ein oder scanne sie. Die Person muss Nostling bereits einmal verwendet haben.',
      inviteSubmit: 'Einladung senden',
      inviteSuccess: 'Einladung erfolgreich gesendet.',
      inviteErrorNoKeyPackage: 'Dieser Nutzer hat seine Nostling-Identität noch nicht eingerichtet.',
      inviteErrorInvalidNpub: 'Ungültiges npub-Format.',
      inviteErrorOffline: 'Du bist offline. Bitte verbinde dich, um Mitglieder einzuladen.',
      inviteErrorTimeout: 'Relay-Zeitüberschreitung. Bitte erneut versuchen.',
      inviteErrorGeneric: 'Einladung fehlgeschlagen. Bitte erneut versuchen.',
      leaveGroup: 'Gruppe verlassen',
      leaveGroupTitle: 'Gruppe verlassen?',
      leaveGroupBody: 'Du verlierst den Zugriff auf diese Gruppe und ihre Nachrichten.',
      leaveGroupConfirm: 'Gruppe verlassen',
      loading: 'Wird geladen...',
      offlineBanner: 'Offline — Gruppensynchronisation nicht verfügbar',
      offlineLastSync: (time) => `Zuletzt synchronisiert: ${time}`,
      syncNow: 'Jetzt synchronisieren',
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
      noMembersYet: 'Noch keine Mitglieder.',
      memberPending: 'Ausstehend',
      memberYou: 'Du',
      cancelInviteButton: 'Einladung zurückziehen',
      cancelInviteTitle: 'Ausstehende Einladung zurückziehen',
      cancelInviteBody: 'Diese ausstehende Einladung zurückziehen? Das Mitglied wird dauerhaft aus der Gruppe entfernt.',
      cancelInviteConfirm: 'Bestätigen',
      cancelInviteSuccess: 'Einladung zurückgezogen',
      cancelInviteError: 'Einladung konnte nicht zurückgezogen werden',
      cancelInviteRaceNotice: 'Diese Einladung ist nicht mehr ausstehend',
      cancelInviteAnnouncementWarning: 'Einladung zurückgezogen, aber der Gruppenchat konnte nicht benachrichtigt werden',
      cancelledByAnnouncement: (member: string, canceller: string) => `${member} wurde von ${canceller} ausgeladen`,
      leftGroup: (member: string) => `${member} hat die Gruppe verlassen`,
      makeAdminButton: 'Als Admin festlegen',
      makeAdminTitle: 'Als Admin festlegen?',
      makeAdminBody: 'Das kann nicht rückgängig gemacht werden. Admins können Mitglieder einladen, Beitrittsanfragen bestätigen, Einladungen zurückziehen und anderen Admin-Rechte erteilen.',
      makeAdminConfirm: 'Als Admin festlegen',
      makeAdminSuccess: 'Admin-Rechte erteilt',
      makeAdminError: 'Admin-Rechte konnten nicht erteilt werden. Bitte erneut versuchen.',
      adminBadge: 'Admin',
      lastAdminLeaveBlocked: 'Du bist der einzige Admin. Erteile einem anderen Mitglied Admin-Rechte, bevor du die Gruppe verlässt.',
      leavePendingBadge: 'Verlassen, Bereinigung ausstehend',
      // removalPendingBadge: reserved for future cause-distinction (see English comment above).
      removalPendingBadge: 'Entfernung ausstehend',
      chatLoading: 'Nachrichten werden geladen...',
      chatEmpty: 'Noch keine Nachrichten. Sag Hallo!',
      chatPlaceholder: 'Nachricht eingeben...',
      chatNewMessages: 'Neue Nachrichten',
      chatJustNow: 'gerade eben',
      chatMinutesAgo: (minutes: number) => `vor ${minutes} Min.`,
      createGroupError: 'Gruppe konnte nicht erstellt werden. Bitte erneut versuchen.',
      imageAttachmentLabel: 'Bild anhängen',
      imageProcessing: 'Bild wird verarbeitet…',
      imageUploading: (pct: number) => `Wird hochgeladen ${pct} %`,
      imageSendFailed: 'Bild konnte nicht gesendet werden',
      imageRetry: 'Erneut versuchen',
      imageDecryptFailed: 'Bild konnte nicht entschlüsselt werden',
      imageUnavailable: 'Bild ist nicht mehr verfügbar',
      imageDownload: 'Herunterladen',
      imageTooLarge: 'Bild ist zu groß',
      imageRemove: 'Bild entfernen',
      pendingInvitations: {
        heading: 'Ausstehende Einladungen',
        acceptBtn: 'Annehmen',
        declineBtn: 'Ablehnen',
        empty: 'Keine ausstehenden Einladungen',
        acceptError: 'Diese Einladung ist nicht mehr gültig',
        relativeJustNow: 'gerade eben',
        relativeMinutesAgo: (n: number) => `vor ${n} Min.`,
        relativeHoursAgo: (n: number) => `vor ${n} Std.`,
        relativeDaysAgo: (n: number) => `vor ${n} Tagen`,
      },
    },
    contacts: {
      pageTitle: 'Kontakte',
      heading: 'Kontakte',
      description: 'Personen aus gemeinsamen Gruppen bleiben hier erhalten, damit du direkt weiterschreiben kannst.',
      emptyTitle: 'Noch keine Kontakte',
      emptyBody: 'Tritt einer Gruppe mit anderen Personen bei, dann erscheinen sie hier.',
      listHeading: 'Alle Kontakte',
      hiddenFilterLabel: 'Versteckte Kontakte',
      hideHiddenOption: 'Versteckte Kontakte ausblenden',
      showHiddenOption: (count: number) => count === 0 ? 'Versteckte Kontakte anzeigen' : `Versteckte Kontakte anzeigen (${count})`,
      hiddenOnlyBody: (count: number) => count === 1 ? '1 versteckter Kontakt wird aktuell ausgeblendet.' : `${count} versteckte Kontakte werden aktuell ausgeblendet.`,
      hiddenBadge: 'Versteckt',
      archiveAction: 'Ausblenden',
      unarchiveAction: 'Wieder einblenden',
      archivedDetailNotice: 'Dieser Kontakt ist in der Standardliste ausgeblendet, bis du ihn wieder einblendest.',
      profileNameFallback: 'Kontakt ohne Namen',
      backToContacts: 'Zurück zu Kontakten',
      contactNotFound: 'Kontakt nicht gefunden.',
      commonGroups: (names: string[]) => `Gruppen: ${names.join(', ')}`,
    },
    profile: {
      pageTitle: 'Profil',
      backLabel: 'Zurück',
      copyNpub: 'Kopieren',
      copiedNpub: 'Kopiert!',
      sendDm: 'Nachricht senden',
      archiveAction: 'Kontakt ausblenden',
      unarchiveAction: 'Kontakt wieder einblenden',
      viewProfile: 'Profil ansehen',
      notFound: 'Profil nicht gefunden.',
      addToGroupLabel: 'Zu einer Gruppe hinzufügen',
      addToGroupSelect: 'Gruppe auswählen',
      addToGroupBtn: 'Zur Gruppe hinzufügen',
      addToGroupSuccess: 'Kontakt zur Gruppe hinzugefügt.',
      addToGroupError: 'Kontakt konnte nicht zur Gruppe hinzugefügt werden. Bitte versuche es erneut.',
      ownHeading: 'Mein Profil',
      ownDescription: 'Passe an, wie du in Nostling erscheinst.',
      backupNeededHint: 'Deine Identität ist noch nicht gesichert. Gehe zu Einstellungen, um sie zu sichern.',
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
    emoji: {
      openPicker: 'Emoji-Auswahl öffnen',
      closePicker: 'Emoji-Auswahl schließen',
      reactWith: 'Mit Emoji reagieren',
      insertEmoji: 'Emoji einfügen',
      removeReaction: 'Reaktion entfernen',
      couldntReact: 'Reaktion fehlgeschlagen',
      reactors: 'Reagiert von',
      reactionCount: 'Reaktionen',
    },
    updateBanner: {
      message: 'Eine neue Version ist verfügbar.',
      reload: 'Neu laden',
      dismissAriaLabel: 'Update-Benachrichtigung schließen',
    },
    feedback: {
      settingsRowLabel: 'Feedback an die Entwickler senden',
      pageTitle: 'Feedback an das Nostling-Team',
      encryptedSubtitle: 'Ende-zu-Ende verschlüsselt · nur das Team kann dies lesen',
      composerPlaceholder: 'Fehler beschreiben, Feature vorschlagen oder einfach hallo sagen…',
      unavailableState: 'Feedback ist momentan nicht verfügbar.',
    },
    advanced: {
      sectionTitle: 'Erweitert',
      toggleExpand: 'Erweiterte Einstellungen anzeigen',
      toggleCollapse: 'Erweiterte Einstellungen ausblenden',
      relays: {
        sectionTitle: 'Relay-Server',
        addPlaceholder: 'wss://relay.beispiel.de',
        addBtn: 'Hinzufügen',
        removeBtn: 'Entfernen',
        resetBtn: 'Auf Standard zurücksetzen',
        saveBtn: 'Speichern',
        savedSuccess: 'Relay-Liste gespeichert.',
        statusConnected: 'Verbunden',
        statusConnecting: 'Verbinde …',
        statusDisconnected: 'Getrennt',
        lastRelayError: 'Mindestens ein Relay ist erforderlich.',
        invalidUrlError: 'Bitte eine gültige wss:// oder ws://-URL eingeben.',
        duplicateUrlError: 'Dieses Relay ist bereits in der Liste.',
        discoverabilityNote: 'Relay-Listen bestehender Gruppen werden nicht geändert.',
      },
      dangerZone: {
        title: 'Gefahrenzone',
        wipeBtn: 'Dieses Gerät löschen',
        wipeConfirmPrompt: 'Geben Sie WIPE ein, um zu bestätigen',
        wipeConfirmBtn: 'Löschen bestätigen',
        wipeConfirmWord: 'WIPE',
        wipeCancel: 'Abbrechen',
        wipeWarning: 'Hierdurch werden Ihre Identität, alle Gruppen und der gesamte Nachrichtenverlauf auf diesem Gerät dauerhaft gelöscht. Dies kann nicht rückgängig gemacht werden.',
      },
      nip46: {
        sectionTitle: 'Externer Signierer',
        description: 'Verbinde einen Hardware-Signierer, eine Browser-Erweiterung oder nsecBunker, um deinen Identitätsschlüssel aus dem Browser zu halten.',
        disclosureGroupFast: 'Gruppennachrichten bleiben schnell — Gruppenschlüssel sind immer lokal.',
        disclosureIdentityLeaves: 'Dein Identitätsschlüssel wird vom externen Signierer gehalten, nicht im Browser.',
        disclosureDmSlow: 'Direktnachrichten-Verlauf und große Gruppeneinladungen werden durch das externe Signieren langsamer.',
        connectQrBtn: 'Per QR / Deep Link verbinden',
        connectPasteBtn: 'bunker://-URI einfügen',
        relayInputLabel: 'Rendezvous-Relay',
        relayInputPlaceholder: 'wss://relay.nsec.app',
        generateQrBtn: 'QR erstellen',
        confirmConnectBtn: 'Genehmigt — Verbinden',
        pasteUriLabel: 'Bunker-URI',
        pasteUriPlaceholder: 'bunker://...',
        connectBtn: 'Verbinden',
        connecting: 'Verbinde …',
        connected: 'Mit externem Signierer verbunden',
        connectedAs: 'Verbunden als',
        reconnecting: 'Verbindung zum Signierer wird wiederhergestellt …',
        disconnect: 'Verbindung trennen',
        signerUnavailable: 'Externer Signierer nicht verfügbar. Veröffentlichung pausiert.',
        retryBtn: 'Erneut versuchen',
        errorUnreachable: 'Bunker nicht erreichbar. Prüfe, ob deine Signierer-App geöffnet ist, und versuche es erneut.',
        authChallengeOpened: 'Eine Autorisierungsseite wurde in einem neuen Tab geöffnet.',
      },
      nip07: {
        sectionTitle: 'Browser-Erweiterung',
        description: 'Signiere mit einer Browser-Erweiterung (Alby, nos2x-fox). Keine Netzwerklatenz — die Erweiterung signiert lokal.',
        connectBtn: 'Erweiterung verbinden',
        connecting: 'Verbinde mit Erweiterung …',
        connected: 'Mit Erweiterung verbunden',
        connectedAs: 'Angemeldet als',
        disconnect: 'Verbindung trennen',
        noExtensionError: 'Keine Nostr-Erweiterung gefunden. Installiere Alby oder nos2x-fox.',
        nip44MissingError: 'Diese Erweiterung unterstützt keine NIP-44-Verschlüsselung. Gruppenfunktionen erfordern NIP-44 (versuche Alby oder nos2x-fox).',
        reconnectError: 'Erweiterung nicht verfügbar. Bitte erneut verbinden.',
      },
    },
    calls: {
      incomingCallTitle: 'Eingehender Anruf',
      incomingVoiceCall: 'Sprachanruf',
      incomingVideoCall: 'Videoanruf',
      acceptCall: 'Annehmen',
      declineCall: 'Ablehnen',
      muteAudio: 'Stumm',
      unmuteAudio: 'Ton an',
      cameraOff: 'Kamera aus',
      cameraOn: 'Kamera an',
      hangUp: 'Auflegen',
      participants: (count: number) => `${count} Teilnehmer${count === 1 ? '' : ''}`,
      callConnected: 'Anruf verbunden',
      startVoiceCall: 'Sprachanruf starten',
      startVideoCall: 'Videoanruf starten',
      callDisabledGroupFull: 'Gruppe zu groß für Anrufe (max. 5)',
      callInProgress: 'Anruf läuft',
      callSettings: 'Anruf-Einstellungen',
      turnServerUrl: 'TURN-Server-URL',
      turnUsername: 'TURN-Benutzername',
      turnCredential: 'TURN-Zugangsdaten',
      saveTurnConfig: 'Speichern',
      ipPrivacyMode: 'IP-Datenschutz-Modus',
      turnHelp: 'Anrufe funktionieren standardmäßig über den öffentlichen openrelayproject-TURN-Relay – denselben, den auch Amethyst nutzt. Leer lassen, um ihn zu behalten, oder unten einen eigenen Relay eintragen.',
      ipPrivacyHelp: 'Medien über TURN leiten, um IP vor Teilnehmern zu verbergen (erhöht Latenz).',
      callStartedNotice: (callerName: string) => `${callerName} hat einen Anruf gestartet`,
      callEndedNotice: 'Anruf beendet',
    },
  },
};

export function getCopy(language: LanguageCode): Copy {
  return copy[language];
}
