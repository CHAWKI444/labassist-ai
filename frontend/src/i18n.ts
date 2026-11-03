import type { Language } from "./types";

const strings = {
  newConversation: { fr: "Nouvelle conversation", en: "New conversation", ar: "محادثة جديدة" },
  conversations: { fr: "Conversations", en: "Conversations", ar: "المحادثات" },
  noConversations: { fr: "Aucune conversation", en: "No conversations yet", ar: "لا توجد محادثات" },
  placeholder: {
    fr: "Posez votre question sur le laboratoire…",
    en: "Ask a question about the laboratory…",
    ar: "اطرح سؤالك حول المختبر…",
  },
  send: { fr: "Envoyer", en: "Send", ar: "إرسال" },
  stop: { fr: "Arrêter", en: "Stop", ar: "إيقاف" },
  retry: { fr: "Réessayer", en: "Retry", ar: "إعادة المحاولة" },
  sources: { fr: "Sources", en: "Sources", ar: "المصادر" },
  page: { fr: "page", en: "page", ar: "صفحة" },
  cited: { fr: "citée", en: "cited", ar: "مستشهد بها" },
  outdated: { fr: "révision en retard", en: "review overdue", ar: "تحتاج مراجعة" },
  language: { fr: "Langue", en: "Language", ar: "اللغة" },
  architecture: { fr: "Architecture", en: "Architecture", ar: "البنية" },
  thinking: { fr: "Recherche dans les sources…", en: "Searching sources…", ar: "جارٍ البحث في المصادر…" },
  welcomeTitle: { fr: "Bonjour, comment puis-je vous aider ?", en: "Hello, how can I help?", ar: "مرحبًا، كيف يمكنني مساعدتك؟" },
  welcomeBody: {
    fr: "Je réponds à partir des documents et des informations approuvés par le laboratoire. Je ne pose pas de diagnostic.",
    en: "I answer from documents and information approved by the laboratory. I do not provide diagnoses.",
    ar: "أجيب استنادًا إلى الوثائق والمعلومات المعتمدة من المختبر. لا أقدم تشخيصًا طبيًا.",
  },
  disclaimer: {
    fr: "LabAssist AI ne remplace pas un avis médical. Les résultats doivent être interprétés par votre médecin.",
    en: "LabAssist AI does not replace medical advice. Results must be interpreted by your physician.",
    ar: "لا يغني LabAssist AI عن الاستشارة الطبية. يجب أن يفسر طبيبك النتائج.",
  },
  details: { fr: "Détails", en: "Details", ar: "تفاصيل" },
  helpful: { fr: "Réponse utile", en: "Helpful answer", ar: "إجابة مفيدة" },
  notHelpful: { fr: "Réponse pas utile", en: "Not helpful", ar: "إجابة غير مفيدة" },
  thanksFeedback: { fr: "Merci pour votre avis", en: "Thanks for your feedback", ar: "شكرًا على رأيك" },
  deleteConfirm: {
    fr: "Supprimer cette conversation ?",
    en: "Delete this conversation?",
    ar: "حذف هذه المحادثة؟",
  },
} satisfies Record<string, Record<Language, string>>;

export type StringKey = keyof typeof strings;

export function t(key: StringKey, language: Language): string {
  return strings[key][language];
}

export const languageLabels: Record<Language, string> = { fr: "Français", en: "English", ar: "العربية" };

export const modeDescriptions: Record<string, string> = {
  auto: "Auto — selects the relevant sources for each question",
  rag: "RAG — answers from uploaded documents (FAISS retrieval)",
  cag: "CAG — answers from the prepared approved-knowledge context",
  mag: "MAG — uses only your saved preferences and memories",
  hybrid: "Hybrid — combines documents, approved knowledge and memories",
};
