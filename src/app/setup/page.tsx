import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STEPS = [
  {
    title: "1. Supabase 프로젝트 만들기",
    body: "supabase.com 에서 New project → 리전은 Northeast Asia (Seoul) 권장. 프로젝트가 만들어지면 Connect 창에서 Project URL 과 Publishable key를 복사합니다.",
  },
  {
    title: "2. 테이블 만들기",
    body: "프로젝트 폴더의 supabase/README.md에 있는 설치 순서대로 SQL을 실행합니다. schema-accounts.sql을 마지막에 적용한 뒤 Authentication에서 Email 로그인과 회원가입을 켜고 Confirm Email을 끕니다.",
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
      <h1 className="mb-1 text-2xl font-semibold">설치 안내</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        새 팀 공간을 설치할 때 사용하는 관리자용 안내입니다.
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
