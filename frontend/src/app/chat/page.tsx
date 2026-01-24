import dynamic from "next/dynamic";
import { Sparkles } from "lucide-react";

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="animate-pulse-soft">
        <Sparkles className="h-8 w-8 text-[#9a9590]" />
      </div>
    </div>
  );
}

const ChatPage = dynamic(() => import("./_components/layout/chat-page").then((mod) => mod.ChatPage), {
  ssr: false,
  loading: () => <LoadingSpinner />,
});

export default function ChatV2Page() {
  return <ChatPage />;
}
