import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STEPS = [
  {
    title: "1. Supabase 프로젝트 만들기",
    body: "supabase.com 에서 New project → 리전은 Northeast Asia (Seoul) 권장. 프로젝트가 만들어지면 Connect 창에서 Project URL 과 Publishable key를 복사합니다.",
  },
  {
    title: "2. 테이블 만들기",
    body: "Supabase 대시보드의 SQL Editor 에 프로젝트 폴더의 supabase/schema.sql 내용을 통째로 붙여넣고 Run 합니다.",
  },
  {
    title: "3. 환경변수 넣기",
    body: "프로젝트 루트에 .env.local 파일을 만들고 NEXT_PUBLIC_SUPABASE_URL 과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 두 줄을 넣은 뒤 개발 서버를 다시 시작합니다.",
  },
  {
    title: "4. Vercel 배포",
    body: "GitHub 에 올린 뒤 Vercel 에서 Import → Environment Variables 에 같은 두 값을 넣고 Deploy 합니다.",
  },
];

export default function SetupPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-6">
      <h1 className="mb-1 text-2xl font-semibold">초기 설정이 필요합니다</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Supabase 연결 정보가 없어서 데이터를 불러올 수 없습니다. 아래 순서대로 진행하세요.
      </p>

      <div className="space-y-3">
        {STEPS.map((step) => (
          <Card key={step.title}>
            <CardHeader>
              <CardTitle className="text-base">{step.title}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{step.body}</CardContent>
          </Card>
        ))}
      </div>

      <pre className="mt-6 overflow-x-auto rounded-lg border bg-background p-4 text-xs">
        {`# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...`}
      </pre>
    </main>
  );
}
