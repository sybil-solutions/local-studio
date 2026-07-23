import { Alert, AppPage, Button, Card, FormField, Input, PageContainer } from "@/ui";

export function AccessPage({ invalid }: { invalid: boolean }) {
  return (
    <AppPage>
      <PageContainer width="sm" className="flex min-h-full items-center justify-center">
        <Card
          className="w-full max-w-md"
          padding="lg"
          title="Unlock Local Studio"
          description="This server can access the host shell and filesystem. Enter the operator-provided access token to continue."
        >
          <form action="/api/auth/session" method="post" className="space-y-4">
            {invalid ? <Alert variant="error">The access token is invalid.</Alert> : null}
            <FormField label="Access token" required>
              <Input
                name="token"
                type="password"
                autoComplete="current-password"
                required
                autoFocus
              />
            </FormField>
            <Button type="submit" size="lg" className="w-full">
              Continue
            </Button>
          </form>
        </Card>
      </PageContainer>
    </AppPage>
  );
}
