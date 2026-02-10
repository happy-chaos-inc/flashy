import { useState } from 'react';
import './CascadeStack.css';

interface CascadeStackProps<T> {
  cards: T[];
  renderCard: (card: T, isFront: boolean) => React.ReactNode;
  getCardBackground?: (card: T) => string;
  getCardBorderColor?: (card: T) => string;
  cardWidth?: number;
  cardHeight?: number;
  cardGap?: number;
  borderColor?: string;
  borderColorBack?: string;
  borderRadius?: number;
}

/**
 * CascadeStack — A horizontal card cascade component.
 *
 * VISUAL BEHAVIOR:
 * - Cards are stacked horizontally, offset to the right like []]]]]]
 * - The frontmost card (index 0 in `order`) is fully visible on the left with the highest z-index
 * - Cards behind it peek out to the right, each offset by `cardGap` pixels
 * - Clicking a back card animates it to the front position
 * - The front card is not clickable (cursor: default)
 * - Only the front card shows its content; back cards are blank peeks
 */
export function CascadeStack<T extends { id: string }>({
  cards,
  renderCard,
  getCardBackground,
  getCardBorderColor,
  cardWidth = 196,
  cardHeight = 110,
  cardGap = 20,
  borderColor = '#B399D4',
  borderColorBack = '#e8dff5',
  borderRadius = 12,
}: CascadeStackProps<T>) {
  // Order array: [frontCardId, ...behindCardIds]
  const [order, setOrder] = useState<string[]>(cards.map(c => c.id));

  const bringToFront = (cardId: string) => {
    setOrder(prev => {
      const newOrder = prev.filter(id => id !== cardId);
      return [cardId, ...newOrder];
    });
  };

  const containerWidth = cardWidth + cardGap * (cards.length - 1);

  return (
    <div
      className="cascade-stack-container"
      style={{
        width: `${containerWidth}px`,
        height: `${cardHeight}px`,
        position: 'relative',
      }}
    >
      {order.map((cardId, stackIndex) => {
        const card = cards.find(c => c.id === cardId);
        if (!card) return null;

        const isFront = stackIndex === 0;
        const leftOffset = stackIndex * cardGap;
        const zIndex = cards.length - stackIndex;

        return (
          <div
            key={cardId}
            className="cascade-card"
            onClick={() => !isFront && bringToFront(cardId)}
            style={{
              position: 'absolute',
              left: `${leftOffset}px`,
              top: 0,
              width: `${cardWidth}px`,
              height: `${cardHeight}px`,
              borderRadius: `${borderRadius}px`,
              borderLeft: `4px solid ${getCardBorderColor ? getCardBorderColor(card) : borderColor}`,
              backgroundColor: getCardBackground ? getCardBackground(card) : '#F9FAFB',
              zIndex,
              cursor: isFront ? 'default' : 'pointer',
              transition: 'all 0.15s ease-out',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
            }}
          >
            {isFront && renderCard(card, true)}
          </div>
        );
      })}
    </div>
  );
}
