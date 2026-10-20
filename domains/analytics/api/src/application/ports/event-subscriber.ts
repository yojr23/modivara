/** Lo que el poller de outbox entrega a cada suscriptor. Si lanza, el poller reintenta con espera creciente. */
export interface EventSubscriber {
  handle(event: unknown): Promise<void>;
}
