export type StudyChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type StudyChatAction =
  | {
      type: "navigate_to_module";
      moduleId: number;
      /** Short reason to show the user (optional). */
      reason?: string;
    }
  | {
      type: "navigate_to_location";
      materialId: string;
      moduleId: number;
      reason?: string;
    }
  | {
      /**
       * Ask the server to locate a module where a term/concept is mentioned.
       * The server resolves this into `navigate_to_module` when possible.
       */
      type: "navigate_by_query";
      query: string;
    };

/** Clickable choice — navigation or follow-up the user can tap. */
export type StudyChatOption = {
  id: string;
  label: string;
  description?: string;
  action: StudyChatAction;
};

export type StudyChatResponse = {
  reply: string;
  action?: StudyChatAction | null;
  options?: StudyChatOption[];
};
