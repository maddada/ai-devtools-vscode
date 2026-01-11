import { ChevronUp, ChevronDown, ChevronsUp, ChevronsDown } from "lucide-react";
import { type FC, useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type ChatNavigationButtonsProps = {
  containerRef: React.RefObject<HTMLElement | null>;
};

export const ChatNavigationButtons: FC<ChatNavigationButtonsProps> = ({
  containerRef,
}) => {
  const [currentUserIndex, setCurrentUserIndex] = useState(-1);
  const [currentAssistantIndex, setCurrentAssistantIndex] = useState(-1);

  const getUserMessages = useCallback(() => {
    if (!containerRef.current) return [];
    return Array.from(
      containerRef.current.querySelectorAll('[data-message-type="user"]')
    );
  }, [containerRef]);

  const getAssistantMessages = useCallback(() => {
    if (!containerRef.current) return [];
    return Array.from(
      containerRef.current.querySelectorAll('[data-message-type="assistant"]')
    );
  }, [containerRef]);

  const scrollToElement = useCallback((element: Element) => {
    element.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const jumpToFirstUserMessage = useCallback(() => {
    const userMessages = getUserMessages();
    if (userMessages.length > 0) {
      scrollToElement(userMessages[0]);
      setCurrentUserIndex(0);
    }
  }, [getUserMessages, scrollToElement]);

  const jumpToLastAssistantMessage = useCallback(() => {
    const assistantMessages = getAssistantMessages();
    if (assistantMessages.length > 0) {
      scrollToElement(assistantMessages[assistantMessages.length - 1]);
      setCurrentAssistantIndex(assistantMessages.length - 1);
    }
  }, [getAssistantMessages, scrollToElement]);

  const jumpToPreviousUserMessage = useCallback(() => {
    const userMessages = getUserMessages();
    if (userMessages.length === 0) return;

    const nextIndex =
      currentUserIndex <= 0 ? userMessages.length - 1 : currentUserIndex - 1;
    scrollToElement(userMessages[nextIndex]);
    setCurrentUserIndex(nextIndex);
  }, [getUserMessages, scrollToElement, currentUserIndex]);

  const jumpToNextAssistantMessage = useCallback(() => {
    const assistantMessages = getAssistantMessages();
    if (assistantMessages.length === 0) return;

    const nextIndex =
      currentAssistantIndex >= assistantMessages.length - 1
        ? 0
        : currentAssistantIndex + 1;
    scrollToElement(assistantMessages[nextIndex]);
    setCurrentAssistantIndex(nextIndex);
  }, [getAssistantMessages, scrollToElement, currentAssistantIndex]);

  // Reset indices when container changes
  useEffect(() => {
    setCurrentUserIndex(-1);
    setCurrentAssistantIndex(-1);
  }, [containerRef]);

  const buttonBaseClasses = cn(
    "size-[50px] rounded-full flex items-center justify-center",
    "bg-muted/80 backdrop-blur-sm border border-border/50",
    "opacity-40 hover:opacity-100 transition-all duration-200",
    "hover:bg-muted hover:border-border hover:shadow-lg",
    "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
    "cursor-pointer"
  );

  return (
    <div className="fixed bottom-6 right-6 flex flex-col gap-2 z-50">
      <button
        onClick={jumpToFirstUserMessage}
        className={buttonBaseClasses}
        title="Jump to first user message"
        aria-label="Jump to first user message"
      >
        <ChevronsUp className="size-6 text-foreground" />
      </button>
      <button
        onClick={jumpToPreviousUserMessage}
        className={buttonBaseClasses}
        title="Previous user message"
        aria-label="Previous user message"
      >
        <ChevronUp className="size-6 text-foreground" />
      </button>
      <button
        onClick={jumpToNextAssistantMessage}
        className={buttonBaseClasses}
        title="Next AI response"
        aria-label="Next AI response"
      >
        <ChevronDown className="size-6 text-foreground" />
      </button>
      <button
        onClick={jumpToLastAssistantMessage}
        className={buttonBaseClasses}
        title="Jump to last AI response"
        aria-label="Jump to last AI response"
      >
        <ChevronsDown className="size-6 text-foreground" />
      </button>
    </div>
  );
};
