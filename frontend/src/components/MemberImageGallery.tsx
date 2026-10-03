import React, { useEffect, useMemo, useState } from 'react';
import { Button, Image } from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';

interface MemberImageGalleryProps {
  imageUrls: string[];
  alt: string;
  height?: number;
  emptyHeight?: number;
  borderRadius?: number;
}

const MemberImageGallery: React.FC<MemberImageGalleryProps> = ({
  imageUrls,
  alt,
  height = 320,
  emptyHeight,
  borderRadius = 12,
}) => {
  const [activeIndex, setActiveIndex] = useState(0);

  const normalizedImages = useMemo(
    () => Array.from(new Set(imageUrls.filter((url) => !!url))),
    [imageUrls]
  );

  useEffect(() => {
    if (activeIndex > normalizedImages.length - 1) {
      setActiveIndex(0);
    }
  }, [activeIndex, normalizedImages.length]);

  if (normalizedImages.length === 0) {
    return (
      <div
        style={{
          height: emptyHeight ?? height,
          borderRadius,
          background: '#fafafa',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#999',
        }}
      >
        暫無圖片
      </div>
    );
  }

  const onPrev = () => {
    setActiveIndex((prev) => (prev === 0 ? normalizedImages.length - 1 : prev - 1));
  };
  const onNext = () => {
    setActiveIndex((prev) => (prev === normalizedImages.length - 1 ? 0 : prev + 1));
  };
  const goTo = (index: number) => setActiveIndex(index);

  const activeImage = normalizedImages[activeIndex] || normalizedImages[0];

  return (
    <div className="member-image-gallery">
      <div className="member-image-gallery-main">
        {normalizedImages.length > 1 && (
          <>
            <Button
              type="default"
              shape="circle"
              icon={<LeftOutlined />}
              className="member-image-gallery-arrow member-image-gallery-arrow-left"
              onClick={onPrev}
              aria-label="上一張圖片"
            />
            <Button
              type="default"
              shape="circle"
              icon={<RightOutlined />}
              className="member-image-gallery-arrow member-image-gallery-arrow-right"
              onClick={onNext}
              aria-label="下一張圖片"
            />
          </>
        )}

        <div className="member-image-gallery-slide">
          <Image.PreviewGroup items={normalizedImages}>
            <Image
              src={activeImage}
              alt={alt}
              style={{ width: '100%', height, objectFit: 'cover', borderRadius }}
            />
          </Image.PreviewGroup>
        </div>
      </div>

      {normalizedImages.length > 1 && (
        <div className="member-image-gallery-thumbs" role="tablist" aria-label="商品圖片縮圖列">
          {normalizedImages.map((imageUrl, index) => (
            <button
              key={`${imageUrl}-${index}`}
              type="button"
              className={`member-image-gallery-thumb${activeIndex === index ? ' is-active' : ''}`}
              onClick={() => goTo(index)}
              aria-label={`切換到第 ${index + 1} 張圖片`}
              aria-pressed={activeIndex === index}
            >
              <img src={imageUrl} alt={`${alt}-${index + 1}`} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default MemberImageGallery;
