<!-- Paste everything below the line into the pull request description. -->

- [x] There is reasonable content on the page (see: [No Content](https://github.com/js-org/js.org/wiki/No-Content))
- [x] I have read and accepted the [Terms and Conditions](http://js.org/terms.html)
- The site content can be seen at <https://toastedbread02.github.io/GoatMedia/>

> The site content is a public video-sharing community built for goat videos —
> a vertical feed with sound, photo albums, uploads that are compressed in the
> browser before they are sent, comments, following, reporting, a human review
> queue, and an explainable recommendation engine that scores watch completion,
> rewatches, likes and skips. The client is React and TypeScript, the server is
> a Cloudflare Worker on D1, and the entire codebase is open source at
> <https://github.com/toastedbread02/GoatMedia>. It is relevant to JavaScript
> developers specifically because the whole application, client and server, is
> readable JavaScript/TypeScript: chunked resumable uploads, byte-range
> streaming of media out of D1, cross-origin bearer auth without cookies, and an
> interest model with plain, tunable weights rather than a black box.
>
> To be straight with you: I am requesting this for the deployed application
> itself, not for a library or a tool, so it may sit outside the scope described
> in the README. If you close it on that basis I understand. The pieces most
> likely to be useful on their own are the chunked upload client, the D1 range
> reader and the scorer, and I would publish one of those as a package before
> asking again.
