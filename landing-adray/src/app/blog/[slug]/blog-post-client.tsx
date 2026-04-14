"use client";

import React from "react";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import Link from "next/link";
import Container from "@/components/ui/Container";
import { brandify } from "@/lib/utils";
import { blogPosts } from "./blog-posts";

const ease = [0.21, 0.47, 0.32, 0.98] as const;

export default function BlogPostClient() {
  const { slug } = useParams<{ slug: string }>();
  const post = blogPosts[slug];

  if (!post) {
    return (
      <section className="pt-40 pb-20">
        <Container className="text-center">
          <h1 className="t-h1 text-white-90 mb-6">Post Not Found</h1>
          <p className="t-p text-ad-muted mb-8">
            The blog post you&apos;re looking for doesn&apos;t exist.
          </p>
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 t-p-sm font-semibold text-gradient"
          >
            ← Back to Blog
          </Link>
        </Container>
      </section>
    );
  }

  return (
    <article>
      <section className="relative pt-40 pb-10 overflow-hidden">
        <Container className="relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease }}
          >
            <Link
              href="/blog"
              className="inline-flex items-center gap-2 t-p-sm text-ad-tag mb-8 hover:text-white-100 transition-colors"
            >
              ← Back to Blog
            </Link>
            <p className="t-p-sm text-ad-tag mb-4">{post.date}</p>
            <h1 className="t-h1 text-white-90 mb-8 max-w-3xl">{post.title}</h1>
          </motion.div>
        </Container>
      </section>

      <section className="pb-12">
        <Container>
          <motion.div
            className="card overflow-hidden rounded-3xl"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.15, ease }}
          >
            <img
              src={post.image}
              alt={post.title}
              className="w-full aspect-2/1 object-cover"
            />
          </motion.div>
        </Container>
      </section>

      <section className="pb-20">
        <Container>
          <motion.div
            className="max-w-2xl mx-auto space-y-6"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3, ease }}
          >
            {post.body.map((p, i) => (
              <p key={i} className="t-p-lg text-ad-muted leading-relaxed">
                {brandify(p)}
              </p>
            ))}
          </motion.div>
        </Container>
      </section>
    </article>
  );
}
