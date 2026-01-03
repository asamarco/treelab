
import Link from 'next/link';
import { Card, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FileQuestion } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-muted/40">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="mx-auto bg-muted rounded-full p-4 w-fit">
            <FileQuestion className="h-12 w-12 text-muted-foreground" />
          </div>
          <CardTitle className="text-3xl font-bold mt-4">404 - Page Not Found</CardTitle>
          <CardDescription className="text-lg">
            Sorry, the page you are looking for does not exist or has been moved.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild className="w-full">
            <Link href="/">Go Back to Homepage</Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
