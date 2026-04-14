import BlogPostClient from "./blog-post-client";
import { blogPostSlugs } from "./blog-posts";

export function generateStaticParams() {
  return blogPostSlugs.map((slug) => ({ slug }));
}

export default function BlogPostPage() {
  return <BlogPostClient />;
}
