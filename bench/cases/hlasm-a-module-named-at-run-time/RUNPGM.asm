RUNPGM   CSECT
         STM   14,12,12(13)
         LR    12,15
         USING RUNPGM,12
         L     2,0(,1)
         MVC   PGMNAME,0(2)
         LINK  EPLOC=PGMNAME
         LM    14,12,12(13)
         SR    15,15
         BR    14
PGMNAME  DS    CL8
         END
