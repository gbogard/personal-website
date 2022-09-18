---
type: Post
title: "Functional error handling with monads, monad transformers and Cats MTL"
date: 2020-05-18
tags:
 - scala
 - cats
 - fp
---

The way we deal with failure in most OOP applications is itself a common source of unexpected behaviors.
I believe exceptions and `try/catch` statements are overused. Most of the time, it isn't obvious what a method might 
throw and when. Edge cases should be treated with the same amount of caution, if not more, than the rest of the code, yet they are rendered
invisible by error-handling mechanisms that hide failures instead of highlighting them.

In this blog post, I will showcase some functional programming techniques, namely monads, monad transformers and Cats MTL, that can
help you deal with failure, in a way that makes it clearly visible. I will also cover the separation of technical failure and business edge cases
to keep business logic where it belongs: at the heart of your software. Prior knowledge of the aforementioned concepts is not required,
as I will attempt to define them along the way. Be aware though that these definitions neither exhaustive
nor the most rigorous. There are as many ways of explaining monads as they have use cases, error handling is just one of them. For a broader definition of
monads, I recommend [this article by Mateusz Kubuszok](https://kubuszok.com/2018/different-ways-to-understand-a-monad/#monad).

This is going to be a rather long ride, so feel free to jump directly to a section of your choosing: 

- [The issues with exceptions]({{< relref "#the-issues-with-exceptions" >}})
- [Bringing back the exceptionality of exceptions]({{< relref "#bringing-back-the-exceptionality-of-exceptions" >}})
- [Monads, a short and probably imperfect definition]({{< relref "#monads-a-short-and-probably-imperfect-definition" >}})
- [IO monads, why do we care?]({{< relref "#io-monads-why-do-we-care" >}})
- [Error handling using Cats Effect IO]({{< relref "#error-handling-using-cats-effect-s-io" >}})
- [Modeling an authentication flow]({{< relref "#the-use-case-modeling-an-authentication-flow" >}})
- [Errors as citizens of your domain]({{< relref "#errors-as-citizens-of-your-domain" >}})
- [The difficulty of combining effects (why monads don't compose)]({{< relref "#the-difficulty-of-combining-effects" >}})
- [Combining effects with monad transformers]({{< relref "#combining-effects-with-monad-transformers" >}})
- [A short detour: Type classes and ad hoc polymorphism]({{< relref "#a-short-detour-type-classes-and-ad-hoc-polymorphism" >}})
- [Introducing Cats MTL]({{< relref "#introducing-cats-mtl" >}})
- [Final examples and conclusion]({{<relref "#final-examples-and-conclusion" >}})

This article is essentially a more in-depth version of a 
[talk on Cats MTL I've given at the 2020 Typelevel Summit](https://www.youtube.com/watch?v=6WXgEGbf0iQ&t=387s). If you're 
looking for a more condensed introduction to monad transformers and functional error handling, consider watching the talk instead.

Let's do this!

## The issues with exceptions

It is common practice, in object-oriented programming, to deal with errors using exceptions and `try/catch` statements. The way they work is familiar to most
developers: something goes wrong, you `throw` an object that represents the issue, and the object will propagate across the entire call stack,
until either a `catch` block is met, or the application shuts down.

This mechanism is convenient and has made is easy to implement
common error handling strategies:

- The way methods can choose to either `catch` an exception or escalate it forms a *chain of delegation*, in which supervising methods are
responsible for the errors of their subordinates. In a way, exceptions mimic the behavior of hierarchies we can find all around us. Like many
OOP concepts, they first seem easier to understand by comparison with the real world.
- The fact that an uncaught exception will eventually shut down the application means it's easy to implement fatal exceptions: just let them run free.
This is surely way more convenient that explicitly calling `exit` when you need to. Right?

But this convenience does not compensate for the risks and mental overhead exceptions produce. When overused, exceptions introduce complexity and potential bugs
to the code base, which all come from this single flaw: exceptions are invisible.

When you look at the signature of a method, you cannot know for certain whether it can fail and under which circumstances. Annotating the method with a 
comment that says "be careful, this might throw these exceptions" is considered a best practice in many languages, and some have a conventional way of doing it,
like `@throws` in Java. But we've all witnessed methods that would throw in production without any prior notice, or with annotations that would lie to our face.
After all, the compiler does not compel me into telling the truth in comments, only proper code review does. People run out of time, get neglectful, forget comments here
and there, and there you have it: uncaught exception in production.

Often, business logic gets added as the software evolves, not everyone is properly informed, obsolete documentation is left behind.

```scala
/**
* This never throws, trust me.
*/
def computeDiscountedPrice(originalPrice: Float, discountPercent: Float) = {
  if (discountPercent > 75) {
    // If you're going to document errors poorly, 
    // you might as well make sure your messages are cryptic and unhelpful
    throw new RuntimeException("Can't apply discount")
  } else {
    originalPrice - (originalPrice * discountPercent / 100)
  }
}
```

In fact, the only way to know for sure the circumstances under which a method may throw is to inspect its implementation and the implementation of
all the methods therein recursively. I hope you can get a feel of the ridiculous mental overhead this introduces, particularly in large code bases. 
When I'm implementing a feature, I should be able to understand the existing  code by looking at, and trust what I'm looking at. 
I should be able to do that without fear of unknown edge cases and unadvertised side effects sneaking behind my back.

This, for me, is one of the main reasons why functional programming is so compelling. FP is, among other things, about trusting what you see. 
While the exact definition of *functional programming* is still subject to some debate, one well-established characteristic is to maximize the use of
functions in the mathematical sense. These functions are

- referentially transparent, or *side-effect free*, which means they only bind some input to some output, i.e., they do nothing more than suggested by their signature
- total, which means they are defined for the entire set of arguments they may receive, i.e., they do nothing less than advertised either

Together, these characteristics ensure that you can understand the code at hand quickly, and refactor it with confidence. 

So clearly, methods that throw exceptions don't fit this definition. Throwing exceptions usually means failing on a particular subset of arguments,
or under specific circumstances, which breaks the rule of totality. We need another way of modeling errors,
and I believe the frustration caused by traditional error handling patterns alone is enough to motivate the learning of something else entirely.

So, if not exceptions, what then?

## Bringing back the exceptionality of exceptions

To make the invisible errors visible again, we need to stop encoding them as exceptions and start encoding them as regular data. We need a way of showcasing
the error cases of our methods directly in their signatures, so they don't surprise anyone anymore, and we need a way of composing error-prone code safely, because
we're not writing our entire application in a single function, right?

One of the ways we can turn errors into data is by using `Option` to model the potential absence of value, and `Either` to model computations that may fail while associating
additional data to the failure. I will introduce some examples of using these structures to handle errors, but I won't dwell on them too much, 

Let's bring our first example back. If we were to refuse the user a discount in certain cases, instead of throwing an exception, we can expand the return type of our function
by using an `Option` instead.

```scala
/**
* This never throws, for real this time.
*/
def computeDiscountedPrice(originalPrice: Float, discountPercent: Float): Option[Float] = {
  if (discountPercent > 75) None
  else Some(originalPrice - (originalPrice * discountPercent / 100))
}
```

This time, the function never throws. Instead, it returns a data type that encodes optionality, leaving the caller responsible for handling every possible case (and if they
don't, the compiler will warn them)

```scala
val validDiscount = computeDiscountedPrice(999.95F, 20.0F)    // Some(799.9600219726562)
val invalidDiscount = computeDiscountedPrice(999.95F, 77.00F) // None
```

Great! No more exceptions blowing up in our faces. Now I know that sometimes this can fail, and I will adapt my code accordingly. But in what circumstances exactly?
`Option` doesn't give us any detail as to why a value is absent, it just is, deal with it. In some cases it is desirable to convey additional information regarding the nature
of the error. For these situations, using an `Either` instead allows us to fail with a particular value, as demonstrated by the next example:

```scala
def computeDiscountedPrice(originalPrice: Float, discountPercent: Float): Either[String, Float] = {
  if (discountPercent > 75) Left("The discount cannot exceed 75%, that would ruin us!")
  else Right(originalPrice - (originalPrice * discountPercent / 100))
}

val validDiscount = computeDiscountedPrice(999.95F, 20.0F)     
// Right(799.9600219726562)
val invalidDiscount = computeDiscountedPrice(999.95F, 77.00F)  
// Left(The discount cannot exceed 75%, that would ruin us!)
```

When we want to enforce a particular condition, there's even a shorter way of doing it:

```scala
def computeDiscountedPrice(originalPrice: Float, discountPercent: Float): Either[String, Float] =
  // Either.cond requires a boolean
  Either.cond(
    discountPercent <= 75,
    // When true, return this wrapped in a Right 
    originalPrice - (originalPrice * discountPercent / 100),
    // When false, return this on the left side instead
    "The discount cannot exceed 75%, that would ruin us!"
  )
```

Note that I chose a `String` as my error type on the left side, but I could have chosen any other type. In practice, I would argue against using `String` on the left side,
and use a sealed type instead, something I will do in further examples. There are two main reasons for this:

- First, there is no way to enforce exhaustivity when matching against strings. This means the compiler will be able to tell when you haven't handled *any error*, but not
that you haven't handled *all the errors*. Sealed types give you this additional safety.
- Secondly, recall how I like my function signature to tell as much as possible? Well, in that case, I know that the method may fail with a message, which is definitely
an improvement, but because a `String` is a very versatile structure, I still have to look at the implementation to know what this message may be. If I use a type
purposefully crafted to model the edge cases of my domain, the name of the type itself can tell me a lot about the nature of the error. Let your types tell the story,
and the implementations will be obvious.

## Monads, a short and probably imperfect definition

There are plenty of good monad introductions out there so I won't pretend to give the most detailed explanation, but I will give something we can work on for the rest of this
article.

`Option` and `Either`, which we have used previously, are both members of a family of structures called *monads*, which are defined by a common *shape*, and some laws.

Generally speaking, for a monad `M`, a value of type `M[A]` represents the computation of one or more values of type `A`, wrapped in the context of the monad. The monad `M`
itself is made of

- a type constructor that enables us to build values of type `M[A]` from simple values of type `A`. In Cats this constructor is called `pure`.
- a function that unwrappes monadic values of type `M[M[A]]` into values of type `M[A]`. This is called `flatten`.
- an applicative functor, which provides the monad with 
  - an `map` function that allows us to transform the monadic value `M[A]` into a `M[B]` by applying some function `A => B`
  - an `ap` function that transforms the monadic value by applying a function `M[A => B]` which is itself wrapped into the monadic context
- some laws called *identities*, which I won't cover here

Cats has [a very good explanation](https://typelevel.org/cats/typeclasses/applicative.html#what-is-ap) for applicative functors, which I won't attempt to recreate here.

Most of the time however, monads are defined using their `flatMap` operator, rather than through the combination of `flatten` and `map`. The `flatMap` operator,
which uses the `>>=` infix notation in many languages, allows us to transforming a monadic value by applying a function from a simple value to a monadic one. It has 
the following signature:

```scala
def flatMap[F[_], A, B](monad: F[A])(fn: A => F[B]): F[B]
```

The `flatMap` operator is often seen as the essence of a monad. It is also called the *composition operator*, because it enables us to chain dependant computations together:
if I have some monadic value `F[A], a function of shape `A => F[B]`, and a function of shape `B => F[C]`, then `flatMap` allows me to compose them, in that order, to get a final
value of type `F[C]`, much like traditional function composition (which Scala expresses with the `andThen` and `compose` operators). 

Let's see how this definition of a monad applies to the `Option` data structure:

- Options have a type constructor from `A` to `Option[A]`, which is called `Some`
  ```scala
  val account: Option[Account] = Some(Account(id = "1234", user = andy))
  ```
- They have a `map` function (the Scala standard library doesn't define an `ap` function, but Cats can do it for us):
  ```scala
  val user: Option[User] = account.map(_.user)
  ```
- And they have a `flatMap` function:
  ```scala
  def getFavoriteAlbum(user: User): Option[Album] = ???

  val favoriteAlbum: Option[Album] = user.flatMap(getFavoriteAlbum)
  ```

Using the monad's capabilities, we are able to chain dependant computation to solve bigger problems out of smaller ones, similarly to how we use functional composition
to split complex functions into smaller ones.

```scala
def getUser(account: Account): User = ???
def getFavoriteAlbum(user: User): Option[Album] = ???
def getHiddenTrack(album: Album): Option[Track] = ???
def getLyrics(track: Track): String = ???

val lyrics: Option[String] =
  account
    .map(getUser)              // Some(User(Andy))
    .flatMap(getFavoriteAlbum) // Some(Album(Abbey Road))
    .flatMap(getHiddenTrack)   // Some(Track(Her Majesty))
    .map(getLyrics)
    // "Her Majesty's a pretty nice girl But she doesn't have a lot to say ..."
```

Finally, because monads in Scala use the `flatMap` operator, which has a special meaning in the language, this monadic composition, like any other, can be expressed with
a [for-comprehension](https://docs.scala-lang.org/tour/for-comprehensions.html) instead, which makes monadic composition feel more like imperative programming, and can
greatly simplify the code in some cases.

```scala
val lyrics: Option[String] = for {
  acc <- getAccount
  user = getUser(acc)
  album <- getFavoriteAlbum(user)
  track <- getHiddenTrack(album)
} yield getLyrics(track)
```

### Monads encode some *effect*

So far we've covered (to some extent) what monads were, but not what they were for, and you might be curious as of why we need them; allow me to explain. 
Monads to *enrich* a computation with some *effect*, some additional behavior specific to the monad at hand. This effect is encoded at the type level, meaning that,
while the type `A` represents a set of computed values, the type `M[A]` represents computed values along with their associated *effect*. Any piece of code that would
like to interact with a monadic value `M[A]` would have to deal with this effect somehow.

The nature of the effect encoded by a monad `M` is specific to that monad:

- `Option` encodes the effect of optionality
- `Either` encodes the effect of failure
- `IO`, as we will cover in more depth, encodes the effect of isolating side-effects
- `Reader` / `Kleisli` encodes the effect of accessing values from an environment, and pass that environment across computations 

Monads allow us to express common computing problems without breaking the purity of our functions: e.g, `Option`s allow us to express the absence of value
without turning to nullable types, `Either`s allow us to express failure without resorting to exceptions. Because these effects are encoded at the type level, the
compiler can compel us to handle them appropriately, making the code safer. For instance, you can compose `Either`s together to build a complex program, and deal with
every possible error case at end, so that your program never crashes at runtime. (That is unless you unwrap the structure prematurely using an unsafe method such as `.get`)

## First error wins

What does using monads mean in the context of error management? [Mark Canlas](https://twitter.com/markcanlasnyc) in a talk called 
[Functional error handling with Cats](https://www.youtube.com/watch?v=KQZjOJjnHIE), which I highly recommend, used the idea of a *happy path* and a
*sad path* to describe the short-circuiting abilities of monads. 

The idea is that when you compose `Option`s together, the final value will be a `Some` only if all the underlying computations yield a `Some`. If any of
the composed `Option`s yield a `None`, the final value will be `None`. The composition will short-circuit on the first encountered error, meaning any
expensive computation after the first `None` is returned won't be evaluated at all.

The same goes for `Either`, which will return either the very last `Right`, or the very first `Left`, and for `Try`, another monad with error handling
abilities. It makes sense for monads to short-circuit computation that way, since monads are used to chain dependant computations: there is no way to evaluate
one part of the composition without the value from the preceding parts.

To summarize: 

- pure functions of simple values such as `A => B` are the simplest building blocks you can use to put a program together: they are easy to understand,
predictable, and they compose. However, sometimes they are not enough. When we need to enrich a computation with an additional behavior, we need to use
types that not only encode values, but also their associated effects
- Monads `M[A]` allow us to enrich the computation of values of type `A` with some functional effect such as optionality, failure, non-determinism,
asynchronism ... The nature of this effect depends on the specific monad at hand
- The essence of a monad is the ability to chain dependant computations together to form one bigger computation, using the `flatMap` operator, also written `>>=`
- Another key property of monads is short-circuiting: when using monads to handle errors, remember that the first error always win

## IO monads, why do we care?

So, monads encode some functional *effect*. The `IO` monad, which you can find an implementation of in the *Cats Effect* library, is another member of this
big family, aiming at encoding side effects and asynchronicity. Consider the following signature:

```scala
def getUser(id: String): cats.effect.IO[User]
```

A value of type `IO[User]` is the representation of a likely impure program that has been turned into a referentially transparent value by *suspending* its execution.
Or to put it differently, it's a value representing a program that will run for an undetermined amount of time, probably has some side effects like connecting to an
external service, and will eventually yield a value of type `User`. Contrarily to Scala's `Future`, it isn't a handle to a computation running on another thread, merely
the blueprint of a program waiting to be explicitly ran.

Because they suspend side effects, `IO`s can be passed around freely and without risks. When chaining them, using `flatMap` like you would any monad, the resulting
composition is itself a lazy representation. The entire program will not run until you call something like `unsafeRunSync` on it. The side effects will run eventually, sure,
but at least not without your explicit consent. 

```scala
import cats.effect.IO

val a = IO(println("- Hello there"))
val b = IO(println("- General Kenobi!"))

// Nothing gets printed yet

(a >> b).unsafeRunSync()
// - Hello there
// - General Kenobi!
```

There is a bit of a debate among functional programmers to decide whether or not IO monads really make impure code pure. Which side you stand on is really a matter of definition.
Even when working with `IO`, your side effects will not magically disappear, they will run eventually. One could say, for the sake of exactitude,
that IO monads are pure up until execution i.e., they are pure representations of impure programs which lose their purity when you run them. But, of course, you are going to run them at
some point, so the distinction is of little value when you just want to ship quality code to production. 

One thing that appeals to theorists and hackers alike though is that `IO`
*reveals* the presence of side effects. Using `IO` is like highlighting dangerous code using types: the non-deterministic parts of your app are clearly segregated from the rest, inviting
authors and reviewers to greater caution. This property is called *effect tracking*. Sadly, in an impure language like Scala, effect-tracking only works if all other functions are
assumed to be pure by convention, there is no way for the compiler to enforce it. Relying on types to track effects, model errors and prevent impossible states is great and will
offload a great deal of mental charge, but it works best when everyone strives for pure functions; a reminder that shipping good code is a team effort.

## Error handling using Cats Effect's IO

The `IO` from Cats Effect, and some other implementations as well, allows their users to *raise* instances of `Throwable` inside the `IO` context, propagate them
across a chain of `IO` when composing, and recover them at some point, much like you would use traditional `throw` statements.

```scala
val failedIO: IO[Int] = IO.raiseError(new Exception("Boom!"))

failedIO.recoverWith({
  case e => IO {
    logger.error("Something went wrong", e)
    42
  }
}).unsafeRunSync()
```

There is subtle difference between raising errors inside `IO`s and throwing in the traditional sense. 
The former merely returns a value that encodes a failed program; it will fail only when explicitly ran. 
The latter interrupts the execution before returning any value:

```scala
// This always returns a value. When composed, all the subsequent IOs will fail too.
def getUser: IO[User] = IO.raiseError(new Exception("No user found"))

// This fails before getting a chance to return an IO.
// It means the program will fail during its construction, not during execution
def getUser: IO[User] = throw new Exception("No user found")
```

Throwing exceptions outside of `IO`s while the consumer expects to always get some value is confusing and dangerous. Please don't do it!

### The use case: modeling an authentication flow

For the rest of this post, I will introduce several error-handling strategies by highlighting the differences in implementing this simple use case:

I want to authenticate a user using a name and a password. My authentication method will return the user's information. After I have found the user
and ensured that their password matched the given input, I also need to enforce a couple of business rules:

- The user must have a valid subscription (this probably requires to call some billing service)
- The user must not be banned from using the service (probably enforced by calling some moderation component)

Each step of the process is a potential source of errors. And since there is a lot of external data fetching, `IO`s will be necessary here.
For each error-handling strategy, I will implement the authentication method by composing smaller programs using monadic composition.
Let's start with the most straightforward approach: raising exceptions inside `IO`s.

I will start by modeling every possible error as a bunch of case objects, every one of them inheriting from `RuntimeException`. That way they can not only
be thrown, which is required by `raiseError`, but also be pattern-matched against, which will make our life much easier.

```scala
case object WrongUserName extends RuntimeException("No user with that name") 
case object WrongPassword extends RuntimeException("Wrong password")
case class ExpiredSubscription(expirationDate: Date) 
  extends RuntimeException("Expired subscription")
case object BannedUser extends RuntimeException("User is banned")
```

Then, I split my logic into small, composable programs. I'll leave the implementation up to you here, I want to focus on the signatures instead. It should be clear enough
what each program is meant to do.

```scala
def findUserByName(username: String): IO[User] = ???
def checkPassword(user: User, password: String): IO[Unit] = ???
def checkSubscription(user: User): IO[Unit] = ???
def checkUserStatus(user: User): IO[Unit] = ???
```

Once I have these programs, I can compose them using `flatMap`. I'll use a for-comprehension here because it's easier to read, but remember it's merely syntactic sugar for good ol'
`flatMap`.

```scala
def authenticate(userName: String, password: String): IO[User] =
  for {
    user <- findUserByName(userName)
    _ <- checkPassword(user, password)
    _ <- checkSubscription(user)
    _ <- checkUserStatus(user)
  } yield user
```

This method first attempts to find my user, then verifies every business rule one after the other, and finally returns my user if everything went well. If any of these intermediate
programs raises an exception, the execution of the entire composition will be aborted, and my `authenticate` method will itself return a failed `IO` with whatever went wrong.
Note that right now, all the checks are made in series cause that's how monads work, but since we are using `IO` and since the program is most likely bound by the network,
independent checks could be done in parallel for improved performance. Have a look at [start/join](https://typelevel.org/cats-effect/docs/2.x/datatypes/io#concurrent-start--cancel) 
to see how it can be achieved. 

Once I have my intermediate programs all composed together, I can call my `authenticate` method and choose what to do with my user. Eventually, I will also have to `recover` my
various errors.

```scala
authenticate("john.doe", "foo.bar")
  .flatMap(user => IO {
    println(s"Success! $user") })
  .recoverWith({
    case WrongUserName => IO { /* Do stuff ... */ }
    case WrongPassword => IO { /* Do stuff ... */ }
    case ExpiredSubscription(date) => IO { /* Do stuff ... */ } 
    case BannedUser => IO { /* Do stuff ... */ }
    case _ => IO {
      println("Another exception was caught !") }
  })
```

This works, however this approach is fundamentally flawed. Errors appear nowhere in the signature of the `authenticate` method, making it impossible to know about them
without some knowledge of the implementation. We've solved the *effect tracking* part by revealing the presence of side effects using `IO`, that's an improvement, but we 
still have to document errors explicitly, just like we would have to if we were throwing exceptions around and catching them.

Remember that when composing `IO`s together to form a bigger program, raised exceptions propagate across the entire composition, making them nearly as deadly as regular `throw`s. 

There is another issue with this: since `IO`s from Cats Effect can only raise and recover descendants of the `Throwable` type, there is no way to know for sure that I have caught
all my business errors, because we can't perform an exhaustive pattern matching on `Throwable`.
This is why I have to add a final `case _ =>` in my pattern matching expression for the sake of exhaustivity. But then if I recover *all* exceptions, how can I know
that I have handled all my business errors properly, and that none of them will match my final *catch-all* branch?

- I want my errors to appear clearly in the signature of my methods so I don't have to know so much about the implementation
- I want to treat every error specifically to give actionable feedback to my users
- I want the compiler to tell me when I forget to handle an error

In other terms, I want my error handling to be truly type-safe. We will address all these concerns in a moment, but first I'd like to clarify something.

## Errors as citizens of your domain

So far, we've been addressing errors as if they belonged to a uniform category. However, in practice, we have to distinguish technical failures from business
edge cases. Let me give some examples.

Many things can go wrong while authenticating a user, for instance the user might not exist, or the database can be unreachable at that particular time. The first
scenario is well defined as part of your business logic: users are expected to forget their credentials and should receive appropriate feedback to guide them, such as
hints toward the credentials recovery procedure. On the other hand, an unreachable component is a purely technical failure that hold meaning neither for your users nor
the business stakeholders; but it doesn't mean it shouldn't be taken care of.

The key insight here is that business errors should provide actionable feedback for your users, whereas technical errors are completely opaque to them
but require a fast response from your team. Business edge cases are expected to happen within the normal life cycle of your application and
should be treated as first-class citizens of the domain model. Technical failures, on the other hand, are not supposed to happen and should be treated according to their severity.

Examples of such technical failures include network outages, misconfiguration of the application, lack of storage on the server and more.
A properly defined error-handling strategy should have a way of modeling them.

Wait a minute, we already know how to model this! Time to bring back our old friend the `Exception`. 

Indeed exceptions are a perfect candidate for this. They can be raised and recovered inside `IO`s (or, as we will unravel later, any type `F` that has some instance of
`MonadError[F, Throwable]` defined for it), they are already used by the vast majority of libraries, and the JVM
already defines a few types of exceptions to choose from such as `IOException` and `TimeoutException`. Most importantly, exceptions will give us some stack trace to work with; 
remember you are targeting your team here, not your end users.

Here is why we rejected exceptions in the first place: most the harm they do to applications (and their developers)
come from how they tend to be overused, which isn't to say that they serve no purpose. 

Exceptions are fine when used to model, well, exceptional behavior. The mistake would be
to use them to model the everyday behavior of your application. When you use them that way, the fact that exceptions naturally propagate across the layers of your application,
or in the case of `IO` across your composition, can even be desirable. Surely we don't wish our application to fail, but when it has to, it's always desirable to *fail fast*.
In the era of micro-services and ever-restarting containers, stopping your application entirely might be the best way of dealing with severe failure.

Here's how I see it:

- Every application should have two distinct error channels to handle both technical failures and business edge cases. The first one is turned towards you and your teammates, the second
towards your end users
- Type signatures should always reveal as much as possible so that the compiler can do its job of helping us properly. It also reduces the amount of documentation required
to understand the code and reduces the risks of bugs. This implies proper tracking of side effects, for the reasons we've seen earlier, but also that the types of our
business-related errors should appear in signatures as well
- The compiler should compel us to handle every business edge case properly, which implies modeling them in a way that enables exhaustivity checks
- Technical failures are typically handled once, at the upper levels of the application

Let's see how we can achieve these goals using Scala and Cats.

## The difficulty of combining effects

Recall how monads are used to encode some *functional effect*. We've seen earlier that `IO`, for example, was used to mark the presence of side effects and model
asynchronous operations. If we wanted to model a computation that can fail with a particular value as the error, we would use `Either` instead, and use the
first type parameter to describe our error type.

But what if we want to model a computation, like our `authenticate` example, that is both asynchronous and error-prone? This very common use case requires some
combination of effects: the asynchronous part will be provided by Cats Effect's `IO`, while the error handling part will be provided by a standard `Either`.
One way of combining these structures together is to nest them. The `authenticate` method from earlier would then be defined as

```scala
def authenticate(
  userName: String,
  password: String
): IO[Either[AuthenticationError, User]]
```

where `AuthenticationError` is a sum type of all my possible errors

```scala
// Look, no more RuntimeException here!
sealed trait AuthenticationError
case object WrongUserName extends AuthenticationError
case object WrongPassword extends AuthenticationError
final case class ExpiredSubscription(expirationDate: Date) extends AuthenticationError
case object BannedUser extends AuthenticationError
```

This is great because now not only side effects and authentication errors both appear in the type signatures, we still have a dedicated, implicit
error channel for technical errors provided by `IO`. This would allow us, in the context of a Web application, to have a global handler of all
technical errors that always returns a `500 Internal Error` to the users and logs the exceptions (This in fact what [Http4s](https://http4s.org/) does by default);
and on top of having that global handler, the compiler would force us to handle every business errors properly. The exhaustivity of our error-handling strategy is guaranteed by
the use of sealed types.

Sadly, while this approach ticks a lot of boxes, it comes at a significant cost. We can't express our `authenticate` method in terms of smaller, specialized programs anymore
because nested monads don't compose nearly as well as monads alone do. One would be tempted to write something like this:

```scala
def findUserByName(username: String): IO[Either[AuthenticationError, User]] = ???
def checkPassword(user: User, password: String): IO[Either[AuthenticationError, Unit]] = ???
def checkSubscription(user: User): IO[Either[AuthenticationError, Unit]] = ???
def checkUserStatus(user: User): IO[Either[AuthenticationError, Unit]] = ???

def authenticate(userName: String, password: String): IO[Either[AuthenticationError, User]] =
  for {
    user <- findUserByName(userName)
    _ <- checkPassword(user, password)
    _ <- checkSubscription(user)
    _ <- checkUserStatus(user)
  } yield user
```

but it wouldn't compile. The reason of this is that, when you have two nested monads, it doesn't necessarily mean that you can define a single monad out of them. There is
no generic way of defining a single monads out of two arbitrary monads. 
[One has to provide instructions on how to compose any outer monad for each specific inner monad](https://typelevel.org/cats/typeclasses/monad.html#composition) they whish
to use. These instructions are provided by a structure called a *monad transformer*, a type constructor that takes two monads as arguments, and return one.

Without such transformer, in order to compose our programs, we would have to `flatMap` the `IO` (the outer monad) and then, inside that, `flatMap` the inner monad, yielding 
code that is very hard to read and maintain:

```scala
def authenticate(userName: String, password: String): IO[Either[AuthenticationError, User]] = 
  findUserByName(userName).flatMap({
    case Right(user) => checkPassword(user, password).flatMap({ 
      case Right(_) => checkSubscription(user).flatMap({
        case Right(_) => checkUserStatus(user).map(_.as(user))
        case Left(err) => IO.pure(Left(err))
      })
      case Left(err) => IO.pure(Left(err)) 
    })
    case Left(err) => IO.pure(Left(err))
  })
```

Fortunately, not only it is possible to define a monad transformer for `Either`, Cats already provides it for us!

## Combining effects with monad transformers

The `EitherT` transformer is one of several monad transformers ready for us to use in Cats. `EitherT[F[_], A, B]` is a light wrapper around `F[Either[A, B]]`, where
`F[_]` can be any monad you want. We say monad transformers are type constructors that take monads as arguments and return monads, simply because, as long a `F[_]` is
a lawful monad, the fully-constructed `EitherT[F[_], A, B]` type will also be a lawful monad.

Effectively monad transformers allow us to enrich a monad, in that case `IO[_]`, with the effect described by another monad, here `Either[A, _]`, in a way that maintains
the ability to compose computations together. By using `EitherT` on `IO`, we effectively get the side effects suspension and asynchronous programming abilities of `IO`, with
the error modeling capacities of `Either`.

There is a bidirectional transformation between `IO[Either[A, B]]` and `EitherT[IO, A, B]`:

```scala
import cats.data.EitherT

val user: IO[Either[AuthenticationError, User]] = IO.pure(Left("No user found"))

// use EitherT.apply to lift a nested Either to an EitherT
val myEitherT: EitherT[IO, AuthenticationError, User] = EitherT(user)

// use .value to demote the EitherT to a nested monad again
val userAgain: IO[Either[AuthenticationError, User]] = myEitherT.value
```

And now that we now about `EitherT`, we can use it to assemble our `authenticate` method once again:

```scala
def findUserByName(username: String): IO[Either[AuthenticationError, User]] = ???
def checkPassword(user: User, password: String): IO[Either[AuthenticationError, Unit]] = ???
def checkSubscription(user: User): IO[Either[AuthenticationError, Unit]] = ???
def checkUserStatus(user: User): IO[Either[AuthenticationError, Unit]] = ???
def authenticate(userName: String, password: String): EitherT[IO, AuthenticationError, User] =
  for {
    user <- EitherT(findUserByName(userName))
    _ <- EitherT(checkPassword(user, password))
    _ <- EitherT(checkSubscription(user))
    _ <- EitherT(checkUserStatus(user))
  } yield user
```

If any of these `EitherT` happens to contain `Left`, the computation will stop amd the result of the `authenticate` method itself will also contain a `Left`.
Not only that, but if any `IO` in there raises an error, the computation will also stop, and the value of the resulting `EitherT`, will in fact also be a
failed `IO`. Hence we have a structure with two distinct error-channels, and double short-circuiting logic. We can combine `EitherT`s together, and the computation
will always return the first encountered error, a pattern sometimes described as *railway-oriented programming*

Authentication errors, which are an essential part of the domain, appear clearly in the type signature, along with the presence of side-effects denoted by `IO`, and
they must be explicitly dealt with. Because `AuthenticationError` is a sealed type, the compiler will tell me
if I forget to handle an authentication error properly.

```scala
authenticate("", "").value.flatMap({
  case Right(user) => IO(println(user))
  case Left(BannedUser) => IO(println(s"Error! The user is banned"))
  case Left(WrongPassword) => IO(println(s"Error! Wrong password"))
})
```

```bash
[warn] EitherTExample.scala:25:38: match may not be exhaustive.
[warn] It would fail on the following inputs: Left(ExpiredSubscription(_)), Left(WrongUserName)
[warn]   authenticate("", "").value.flatMap({
[warn]                                      ^
[warn] one warning found
```

Curious how `EitherT` works?

 The `flatMap` implementation of `EitherT` properly describes the short-circuiting logic between an `EitherT[F, A, B]` and a dependent
`B => EitherT[F, A, C]` function, which I will call the *next `EitherT`*. It does exactly what we have been doing earlier: 
first combine the outer `IO`, and then match the inner `Either`. If the value inside the first `IO` is a `Right`, 
we can can continue the computation applying whatever value was found inside that `Right` to the *next `EitherT`*;
if it's a `Left`, we halt the computation by lifting that `Left` inside an `F[_]`, and the *next `EitherT`* is never evaluated.

```scala
// defined on cats.data.EitherT

def flatMap[AA >: A, D](f: B => EitherT[F, AA, D])(implicit F: Monad[F]): EitherT[F, AA, D] =
    EitherT(F.flatMap(value) {
      case l @ Left(_) => F.pure(l.asInstanceOf[Either[AA, D]])
      case Right(b)    => f(b).value
    })
``` 

`EitherT` allows us to achieve a sound, type-safe error-handling strategy, while keeping things relatively easy to implement.

- Side effects are properly tracked
- Business errors are no longer invisible, instead they are treated as first-class citizens of the domain
- We have a distinct error channel for purely technical failures, so they don't pollute our domain logic
- The Scala compiler can compel us to handle every business error, reducing the opportunities for bugs in the application
- Overall, we can *fail fast* on technical failures, and easily provide actionable feedback to our users when don't use our application
as intended.

On top of that, I haven't mentioned some other very useful characteristics of `EitherT`, such as the ability to build an `EitherT[F, A, B]`
from an `Option[B]`, or even a `F[Option[B]]`, or the ability to construct an `EitherT` out of a boolean value using  `EitherT.cond`. Overall `EitherT`
is a very powerful structure, enabling a very clean and elegant approach to error management.

However, not all is great in the land of monad transformers, and there are still some issues that, depending on the app you're building, might need
to be addressed. 

The first of these issues is performance. Monad transformers in Scala are rather slow, much more so than their Haskell counterparts.
I've never found it to be a big deal, and I believe it won't be for most applications, since there are so many other potential
bottlenecks to look after before trying to reduce the number of monad transformers. For IO-bound applications, 
[the overhead of monad transformers is mostly irrelevant](https://twitter.com/djspiewak/status/1256352799278784515); for CPU bound applications, your
mileage may vary.

The second issue with monad transformers appears when you try to stack them together. We've said earlier that monads were used to describe
some *effect*, and that monad transformers were used to, sort-of, enrich an existing monad with the effect described by another monad, effectively
resulting in a structure that combines both effects, while preserving the ability of chaining computations (i.e. a monadic structure itself).
With that understanding, it makes sense to attempt using more than one transformer at a time: what if I want *this* effect and *that* effect
at the same time? In theory you could, e.g., stack a `ReaderT`, an `EitherT` and an `IO` together, to create a new monad that has

- the ability to read values from some read-only context (described by `ReaderT`)
- the ability to short-circuit using any arbitrary type as the error type (described by `EitherT`)
- and the suspension of side-effects provided by `IO`

In practice however, stacking monad transformers in Scala require a shocking amount of boilerplate, leading developers to the idea
that maybe they should drop monad transformers altogether and go back to raising exceptions. Take a look at the following code:

```scala
// Retrieves document from a super secure data store
def getDocument: IO[SecretDocument] = ???

def destroyDocument: IO[Unit] = IO.unit

type Count = Int
val readSecretDocument: User => EitherT[IO, String, SecretDocument] = {
  val state: StateT[ReaderT[IO, User, *], Count, Either[String, SecretDocument]] =
    StateT[ReaderT[IO, User, *], Int, Either[String, SecretDocument]](currentAttemptsCount =>
      ReaderT[IO, User, (Count, Either[String, SecretDocument])](user =>
        if (currentAttemptsCount >= 3) 
          destroyDocument.as((currentAttemptsCount, Left("Max attempts exceeded")))
        else if (user.isAdmin) getDocument.map(doc => (currentAttemptsCount, Right(doc)))
        else IO.pure((currentAttemptsCount + 1, Left("Access denied")))
      )
    )

  state.run(0).map(_._2).mapF(EitherT(_)).run
}
```

This defines a function that, given a User, may or may not give access to some secret document, based on some simple rules. To be given access to the document,
the user must be an administrator. Every time an unauthorized person attempts to access the document, we increment a counter. After 3 failed attempts, the document is destroyed. This particular implementation uses stacked monad transformers and is purely functional™

- It uses `IO`, because our super secure data store is asynchronous, and destroying a document is a side-effect
- It uses `EitherT` for its error-handling abilities
- It uses `StateT` to model the mutable state of our attempts counter

But it's also completely recondite, especially given how simple implementing such a use case should be. The main reason behind this excessive amount
of boilerplate is the amount of type parameters the compiler has to deal with: Scala's type inference system can't keep up with nested transformers, forcing you
into providing every type specifically.

Code like this helps use understand why some  functional programming advocates sometimes fail to promote the benefits 
of the functional paradigm outside their circle: the purity of such code 
simply isn't worth the tradeoff of a nearly unreadable implementation. People who have been practicing FP for a long time know how
it enables them to do what most of what imperative languages do in a safer way, but also with less boilerplate; yet this is an example of something that is completely straightforward in imperative programming, and sadly convoluted when using monad transformers.

Clearly we must do something better.

To achieve the goal of stacking functional effects elegantly, I will introduce a library called Cats MTL; but before that, we need to take a short detour to explain how these effects are encoded in Scala. This will help us understand the Cats MTL examples better.

## A short detour: type classes and ad hoc polymorphism

*Ad hoc polymorphism* is a general concept to describe methods that operate on various concrete types. One of the way we can achieve this kind of
polymorphism in Scala is by combining type parameters (*generics*) and type classes. 

We use implicit parameters or context bounds (the latter is just syntactic sugar for the former) to define constraints on type parameters. 
These constraints limit the concrete structures we can apply methods to, while allowing us to take advantage of the required contracts.

Consider these methods:

```scala
def combineHeaders(a: Headers, b: Headers): Headers = 
  // Some complex combination logic
  ???

def combineAllHeaders(list: List[Headers]): Headers = 
  list.foldLeft(Headers.empty)(combineHeaders)
```

Using concrete structures require us not only to define methods with different names for every concrete structure we want to combine, but also to
redefine the `combineAll` method every time; not to mention that if we wanted to use something else than a `List`, e.g. a `Vector` or a `Set`,
we would have to define specialized versions of the `combineAll` method as well.

Instead, type classes allow us to write something like this:

```scala
import cats._
import cats.implicits._

def combineAll[F[_]: Foldable, A: Monoid](f: F[A]) = f.foldLeft(Monoid[A].empty)(Monoid[A].combine)
```

The `combineAll` method in this example is not only defined for concrete structures such a `List` and `Headers`, but for *any structure
`F[_]` that can be folded, and any type `A` which values can be combined*. The `Monoid` type class from Cats describes types that have an
associative binary operation and an empty element; any type that implements this contract can benefit from the `combineAll` method.

I've covered type classes in more details in [another article]({{< ref  "/posts/typeclasses" >}}). Cats MTL relies entirely on the concept
of type classes to do its work, so make sure to familiarize yourself with the concept before what comes next.

## Introducing Cats MTL

Here we are, reaching the end of an article that, now that I think about it, might have benefited from being split into many. If you made it this far,
thank you! We have covered effect tracking, type-safe error handling, technical errors vs domain errors, monads, nested monads, monad transformers and
even nested monad transformers; now it is time to build on everything we have learned so far to achieve the final version of our authentication use case.

We will use [Cats MTL](https://typelevel.org/cats-mtl/getting-started.html), a library that unifies monad transformers with type classes, in a way that
makes it easier to stack many transformers together.

The idea of Cats MTL is relatively straightforward: monad transformers are used to add the effect of a monad to another monad, and Cats MTL encodes the
effects of the most commons monad transformers (`OptionT`, `EitherT`, `ReaderT`, `WriterT`, `StateT` and `IorT`) using type classes. When you require many
of these type classes, using context bounds or implicit parameters like we've seen before, you are effectively stacking monad transformers together; but because
you do it through an additional layer of abstraction, you don't have to deal with the painful type inference issues we have faced earlier.

### Raising errors

In Cats MTL, the `FunctorRaise[F[_], E]` type class is used to provide some structure `F[_]` with the ability to raise errors
of type `E`. We can use it to write a password verification method that raises errors of type `AuthenticationError`:

```scala
import cats.implicits._
import cats.mtl._
import cats.mtl.implicits._

def checkPassword[F[_]](user: User, password: String)(
  implicit FR: FunctorRaise[F, AuthenticationError],
  A: Applicative[F]
): F[Unit] = if (password == "1234") A.unit else FR.raise(WrongPassword)
```

Note that requiring `FunctorRaise` implies a `Functor` can be defined for `F`, meaning we can map over `F[_]` values without an explicit requirement on
the `Functor` type class.
`Applicative` is required to build a "neutral" `F[Unit]` value, since the `unit` method is defined for applicative functors, not regular functors.

### Recovering

The `ApplicativeHandle[F[_], E]` type class, also from Cats MTL, extends `FunctorRaise[F[_], E]` with the ability for `F[_]` to recover values of type `E`.
It also implies an instance of `Applicative[F]`.

```scala
def runAndLogErrors[F[_], A, E](program: => F[A])(
  implicit logger: E => F[Unit],
  AH: ApplicativeHandle[F, E],
  M: Monad[F]
): F[A] = 
  // We "catch" the error, log it, and then raise it again
  program.handleWith((e: E) => logger(e) >> e.raise[F, A])
```

In this example, we must require an instance of `Monad` for `F[_]` to be able to call `>>` operator, which allows us
to evaluate one monadic value after the other.

### Two error channels for two types of errors

We can require many type classes instances to get back the benefit of having distinct error channels to distinguish
between technical failures and domain errors; specifically, 
we can combine the `FunctorRaise` / `ApplicativeHandle[F, DomainError]`
type classes from Cats MTL, and the `MonadError[F, TechnicalError]` type class from Cats core, where `DomainError`
will most likely be a sealed type of our own making, such as `AuthenticationError`, and 
`TechnicalError` will most likely be `Throwable`.  

```scala
def findUserByName[F[_]](name: String)(
  implicit ME: MonadError[F, Throwable]
): F[User] = ME.raiseError(new RuntimeException("The database cannot be reached"))
```

`ApplicativeHandle[F, E, A] ` and `FunctorRaise[F, E, A]` are the most useful type classes
when dealing with failure. Cats MTL will provide us with instances of these type classes not only for 
`EitherT[F, E, A]` (provided `F` meets the expected requirements) but also for any stack of monad 
transformers containing an `EitherT[F, E, A]`. 

Cats MTL enables us to manipulate stacked monad transformers without dealing with the pain of poor
type inference.

## Final examples and conclusion

Let's see how the type classes from Cats MTL can be applied to our `authenticate` method. Remember
we want to implement the method in terms of smaller, specialized programs, and then compose these programs together.

```scala
def findUserByName[F[_]](name: String)(
  implicit ME: MonadError[F, Throwable]
): F[User] = ME.raiseError(new RuntimeException("The database cannot be reached"))

def checkPassword[F[_]](user: User, password: String)(
  implicit FR: FunctorRaise[F, AuthenticationError],
  A: Applicative[F]
): F[Unit] = if (password == "1234") A.unit else FR.raise(WrongPassword)

def checkSubscription[F[_]](user: User): F[Unit] = ???
def checkUserStatus[F[_]](user: User): F[Unit] = ???

def authenticate[F[_]](userName: String, password: String)(
  // We depend on the requirements of our intermediate methods
  implicit ME: MonadError[F, Throwable],
  functorRaise: FunctorRaise[F, AuthenticationError]
): F[User] =
  for {
    user <- findUserByName[F](userName)
    _ <- checkPassword[F](user, password)
    _ <- checkSubscription[F](user)
    _ <- checkUserStatus[F](user)
  } yield user
```

As expected, the `authenticate` method will short-circuit on the first encountered error in any of the error
channels. Technical errors and domain errors can be dealt with specifically, with proper exhaustivity checks for
the latter. Let's illustrate this by simulating how this could be used in an HTTP server:

```scala
// Let's pretend this is an HTTP server for a moment
final case class HttpResponse(code: Int, body: String)

def authenticateAndServeResponse[F[_]](implicit
    ME: MonadError[F, Throwable],
    AE: ApplicativeHandle[F, AuthenticationError],
    // `Sync` is the type class that describes the ability to suspend side effects
    // `IO` provides a concrete instance of Sync
    Sync: Sync[F]
): F[HttpResponse] =
  authenticate[F]("john.doe", "123456")
    // If the authentication succeeds, we return the "200 OK" status
    .map(user => HttpResponse(code = 200, body = user.toString))
    // Here we can handle business errors if we want to. 
    // "handleWith" expects us to produce an [[HttpResponse]], 
    // just like the [[authenticate]] method.
    .handleWith[AuthenticationError]({
      case e @ WrongUserName =>
        Sync.delay { /* Do stuff, like logging the error ... */ } as 
          HttpResponse(403, "Wrong username!")
      case e @ WrongPassword =>
        Sync.delay { /* Do stuff, like logging the error ... */ } as 
          HttpResponse(403, "Wrong password!")
      case e: AuthenticationError =>
        Sync.delay(println(s"Another domain error was caught ! ($e)")) as
          HttpResponse(403, e.toString)
    })
    // Here we can handle technical failures. 
    // "recoverWith" expects us to produce an [[HttpResponse]]
    // Since this is a technical, server-side failure, we're going to send 
    // a "500 Internal Server Error" status
    .recoverWith({
      case e: Throwable =>
        Sync.delay(println("Something went terribly wrong!")) as 
          HttpResponse(500, "Something went wrong on our side, please retry later")
    })
```

Seperating erors this way comes in useful for implementing retry strategies: if the requested action
can't be performed because of temporary network outage, it probably makes sense to retry a few seconds layer. But
if the error comes from the client-side, we don't need a retry strategy, we need to send proper feedback.

### Interpreting the program

When comes of time of running our final program, we must provide a concrete instance for our `F[_]` type;
one that satisfies the contracts of `MonadError[F, Throwable]`, `ApplicativeHandle[F, AuthenticationError]`
and `Sync[F]`. What is such a data structure?

```scala
// Time to interpret the program
object Main extends App {
  type F[A] = EitherT[IO, AuthenticationError, A]

  authenticate[F]("john.doe", "123456")
}
```

`EitherT[IO, AuthenticationError, A]` satisfies all these conditions:

- the ability to suspend side-effects, described by the `Sync` type class, and to raise technical errors of type
`Throwable`, described by `MonadError`, are both implemented by `IO`
- the ability to raise and recover errors of type `AuthenticationError` is guaranteed by a concrete instance
of `ApplicativeHandle[F, AuthenticationError]`, provided for us by Cats MTL, for any 
`EitherT[F, AuthenticationError, A]`, and any monad transformer stack containing the latter, as long as `F` has
an instance of `Applicative` (which again is provided by `cats.effect.IO`)

In conclusion, monads and monad transformers give us the ability to define a sound, truly type-safe error
handling strategy, and Cats MTL gives us an easier a way of working with monad transformers.

Whichever solution you choose, here a few key takeaways to remember:

- errors are parts of your domain too! try to reveal them using the type system, instead of burying then in
the implementation
- don't mistake technical errors for domain edge-cases. When modeling errors, ask yourself "Is this of any
value to my users, or does it make sense to me as developer only?"
- use sealed types to encode your errors so the compiler can help you catch oversights
- monads compose in a *first error wins* fashion. If you need to accumulate errors instead, turn to `Validated`
instead. Again, [Mark Canlas' talk](https://www.youtube.com/watch?v=KQZjOJjnHIE) is a great place to start
- don't overuse exceptions
- FP, with its emphasis on referential transparency, is a lot about *type signatures you can trust™*.
Monads allow us to advertise the presence of side-effects and the risk of failure using types, which
dramatically reduces unexpected behavior, and in turn maintainability of your applications

As always, thank you for reading this article, I hope this gave you a better understanding of some functional
programming concepts, and how they apply to real-world use cases.
[This repository](https://github.com/gbogard/cats-mtl-talk) contains a Scala project with almost all the
examples from this article, and some more.

See ya!
