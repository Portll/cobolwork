SSARSET  CSECT
         STM   14,12,12(13)
         LR    12,15
         USING SSARSET,12
         L     2,0(,1)
         LH    3,0(,2)
         SSAR  3
         LM    14,12,12(13)
         SR    15,15
         BR    14
         END
