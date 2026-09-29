       IDENTIFICATION DIVISION.
       PROGRAM-ID. TDTYPE.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  COMPLEX-T TYPEDEF.
           05  RE           COMP-2.
           05  IM           COMP-2.
       01  MONEY-T          PIC S9(7)V99 COMP-3 TYPEDEF.
       01  NAME-T           PIC X(20) TYPEDEF.
       01  WS-Z             TYPE COMPLEX-T.
       01  WS-PAIR.
           05  FIRST-Z      TYPE COMPLEX-T.
           05  PRICE        TYPE MONEY-T.
           05  LABEL-TXT    TYPE TO NAME-T.
           05  PRICES       TYPE MONEY-T OCCURS 3.
       77  TOTAL            TYPE MONEY-T.
       LINKAGE SECTION.
       01  LK-Z             TYPE COMPLEX-T.
       PROCEDURE DIVISION USING LK-Z.
           MOVE RE OF WS-Z TO RE OF LK-Z
           DISPLAY WS-PAIR TOTAL
           GOBACK.
