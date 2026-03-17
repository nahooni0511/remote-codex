import styles from "./Icon.module.css";

const icons = {
  terminal:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="3"></rect><path d="m7 9 3 3-3 3"></path><path d="M12.5 15.5h4.5"></path></svg>',
  chat:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M6 17.5 3.5 20V6.5A2.5 2.5 0 0 1 6 4h12a2.5 2.5 0 0 1 2.5 2.5v8A2.5 2.5 0 0 1 18 17H6Z"></path><path d="M8 9.5h8"></path><path d="M8 13h5"></path></svg>',
  play:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5"></circle><path d="m10 8.8 5.2 3.2L10 15.2V8.8Z" fill="currentColor" stroke="none"></path></svg>',
  settings:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="m9.4 3.8-.6 2.3a6.9 6.9 0 0 0-1.4.8L5 5.8 3.8 7l1.1 2.4a6.9 6.9 0 0 0-.8 1.4l-2.3.6v1.7l2.3.6c.2.5.5 1 .8 1.4L3.8 17 5 18.2l2.4-1.1c.4.3.9.6 1.4.8l.6 2.3h1.7l.6-2.3c.5-.2 1-.5 1.4-.8l2.4 1.1 1.2-1.2-1.1-2.4c.3-.4.6-.9.8-1.4l2.3-.6v-1.7l-2.3-.6a6.9 6.9 0 0 0-.8-1.4L18.2 7 17 5.8l-2.4 1.1a6.9 6.9 0 0 0-1.4-.8l-.6-2.3H9.4Z"></path><circle cx="12" cy="12" r="2.9"></circle></svg>',
  plus:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>',
  folder:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.5a2.5 2.5 0 0 1 2.5-2.5h4l1.8 2H18a2.5 2.5 0 0 1 2.5 2.5v5A2.5 2.5 0 0 1 18 18H6a2.5 2.5 0 0 1-2.5-2.5v-7Z"></path></svg>',
  refresh:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7"></path><path d="M20 4v7h-7"></path></svg>',
  download:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4.5v9"></path><path d="m8.5 10.5 3.5 3.5 3.5-3.5"></path><path d="M5 18.5h14"></path></svg>',
  warning:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4.5 20 18.5H4L12 4.5Z"></path><path d="M12 9v4.5"></path><path d="M12 16.8h.01"></path></svg>',
  menu:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M4 7h16"></path><path d="M4 12h16"></path><path d="M4 17h16"></path></svg>',
  send:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 13-7-3 7 3 7-13-7Z" fill="currentColor" stroke="none"></path></svg>',
  attachment:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 12.5 13 8a3 3 0 1 1 4.2 4.2l-6.8 6.8a5 5 0 0 1-7.1-7.1l7.4-7.4"></path></svg>',
  code:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="m8 8-4 4 4 4"></path><path d="m16 8 4 4-4 4"></path><path d="m13.5 5-3 14"></path></svg>',
  check:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="m8.5 12.4 2.3 2.3 4.8-5.2"></path></svg>',
  phone:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M6.8 4.5h3.2l1.2 4-2 1.8a15 15 0 0 0 4.5 4.5l1.8-2 4 1.2v3.2a1.8 1.8 0 0 1-2 1.8c-7.6-.5-13.8-6.7-14.3-14.3a1.8 1.8 0 0 1 1.8-2Z"></path></svg>',
  bot:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="5.5" y="8" width="13" height="10" rx="3"></rect><path d="M12 4.5v3"></path><path d="M9 12h.01"></path><path d="M15 12h.01"></path><path d="M8.5 17.5v1.5"></path><path d="M15.5 17.5v1.5"></path></svg>',
  help:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M9.5 9.2a2.7 2.7 0 1 1 4.6 2c-.8.8-1.6 1.2-1.6 2.6"></path><path d="M12 16.8h.01"></path></svg>',
  search:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4.5 4.5"></path></svg>',
  trash:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 7h15"></path><path d="M9.5 4.5h5"></path><path d="M8 7v11"></path><path d="M16 7v11"></path><path d="M6.5 7.5 7.2 18a2 2 0 0 0 2 1.8h5.6a2 2 0 0 0 2-1.8l.7-10.5"></path></svg>',
  spark:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 1.8 4.8L19 9.6l-4.2 2.1L13 17l-1.8-5.3L7 9.6l5.2-1.8L12 3Z"></path></svg>',
  shield:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.8 18.5 6v5.3c0 4-2.4 6.9-6.5 8.9-4.1-2-6.5-4.9-6.5-8.9V6L12 3.8Z"></path></svg>',
  branch:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="7" cy="6.5" r="2"></circle><circle cx="17" cy="17.5" r="2"></circle><circle cx="17" cy="6.5" r="2"></circle><path d="M9 6.5h6"></path><path d="M7 8.5v5a4 4 0 0 0 4 4h4"></path></svg>',
  chevronDown:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"></path></svg>',
  mic:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="4.5" width="6" height="10" rx="3"></rect><path d="M7 11.5a5 5 0 0 0 10 0"></path><path d="M12 16.5v3"></path><path d="M9 19.5h6"></path></svg>',
  stop:
    '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="7" y="7" width="10" height="10" rx="2.2"></rect></svg>',
} as const;

export type IconName = keyof typeof icons;

export function Icon({ name }: { name: IconName }) {
  return <span className={styles.icon} aria-hidden="true" dangerouslySetInnerHTML={{ __html: icons[name] || icons.chat }} />;
}
